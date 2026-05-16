import type { FastifyPluginAsync } from "fastify";
import type { DestinationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { summarizeIntakeResponses } from "../lib/intake-summary.js";
import { sendIntakeNotificationEmail } from "../lib/notify-intake-email.js";
import { parseIntakeFormSchema } from "../lib/intake-schema.js";
import { parsePageSchema } from "../lib/page-schema.js";
import {
  defaultSiteNavConfig,
  parseSiteNavConfig,
} from "../lib/site-nav-schema.js";
import {
  getAllSettings,
  getOrCreateIndexNowKey,
  SETTING_KEYS,
} from "../lib/site-settings.js";
import {
  classifyReferrer,
  resolveGeo,
  getClientIp,
  hashIp,
  parseUserAgent,
} from "../lib/analytics.js";
import {
  checkIntakeSubmitRateLimit,
  clientIpFromRequest,
} from "../lib/rate-limit-memory.js";
import { getSession } from "../lib/request-session.js";
import {
  sanitizeResponses,
  validateIntakeResponses,
} from "../lib/validate-intake-response.js";

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function rankAirport(
  q: string,
  a: {
    iata: string;
    icao: string | null;
    name: string;
    city: string;
    country: string;
  },
): number {
  const ql = q.toLowerCase();
  if (a.iata.toLowerCase() === ql) return 1000;
  if (a.icao?.toLowerCase() === ql) return 900;
  if (a.iata.toLowerCase().startsWith(ql)) return 800;
  if (a.city.toLowerCase() === ql) return 700;
  if (a.city.toLowerCase().startsWith(ql)) return 600;
  if (a.name.toLowerCase().startsWith(ql)) return 500;
  if (a.country.toLowerCase() === ql) return 400;
  return 100;
}

function rankDestination(
  q: string,
  d: { slug: string; name: string; country: string | null; aliases: string | null },
): number {
  const ql = q.toLowerCase();
  if (d.name.toLowerCase() === ql) return 1000;
  if (d.slug === ql) return 950;
  if (d.name.toLowerCase().startsWith(ql)) return 800;
  if (d.aliases?.toLowerCase().includes(ql)) return 650;
  if ((d.country ?? "").toLowerCase() === ql) return 500;
  return 100;
}

/** Public intake — no auth required; optional session links submission to user. */
export const publicIntakeRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Anonymous analytics ingest. Records one event per pageview ping.
   * Strips any client-side claims about geo / IP / browser — those
   * come from the request headers we trust. Body fields are short and
   * loosely validated to keep the endpoint hot-path cheap.
   *
   * The Do Not Track header is honored — events from DNT users are
   * silently 204'd.
   */
  app.post("/analytics/track", async (request, reply) => {
    const dnt = request.headers["dnt"];
    if (dnt === "1") return reply.status(204).send();

    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "Invalid body" });
    }

    function str(v: unknown, max = 500): string | null {
      if (typeof v !== "string") return null;
      const t = v.trim();
      if (!t) return null;
      return t.length > max ? t.slice(0, max) : t;
    }

    const visitorId = str(body.visitorId, 64);
    const sessionId = str(body.sessionId, 64);
    const path = str(body.path, 500);
    if (!visitorId || !sessionId || !path) {
      return reply.status(400).send({ error: "Missing visitorId/sessionId/path" });
    }

    // Defense-in-depth: even if the frontend tracker misfires for any
    // reason (or someone replays a payload), drop admin-route events
    // server-side. Admin activity is internal team usage, not visitor
    // behavior, and pollutes every analytics chart.
    if (path === "/admin" || path.startsWith("/admin/")) {
      return reply.status(204).send();
    }

    // Goal events: snake_case, past tense, e.g. "checkout_completed".
    // Cap to 64 chars and normalize.
    const rawType = str(body.eventType, 64);
    const eventType = rawType
      ? rawType.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64)
      : null;
    const eventValueRaw = body.eventValue;
    const eventValue =
      typeof eventValueRaw === "number" &&
      Number.isFinite(eventValueRaw) &&
      Math.abs(eventValueRaw) < 1_000_000_000
        ? Math.round(eventValueRaw)
        : null;

    const ip = getClientIp(request);
    const ua = parseUserAgent(
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"]
        : null,
    );
    if (ua.device === "bot") return reply.status(204).send();

    const geo = resolveGeo(request, ip);

    // Determine "self" host from the page URL the client claimed to be
    // on, so an in-site nav doesn't show as a referrer to itself.
    let selfHost: string | null = null;
    try {
      const pf = str(body.pathFull, 1000);
      if (pf) selfHost = new URL(pf).hostname;
    } catch {
      selfHost = null;
    }
    const cls = classifyReferrer(str(body.referrer, 1000), selfHost);

    // Optional session — link to logged-in user if available.
    let userId: string | null = null;
    try {
      const s = await getSession(request);
      userId = s?.user?.id ?? null;
    } catch {
      userId = null;
    }

    const durationMsRaw = body.durationMs;
    const durationMs =
      typeof durationMsRaw === "number" &&
      Number.isFinite(durationMsRaw) &&
      durationMsRaw >= 0 &&
      durationMsRaw < 60 * 60 * 1000 // hard cap at 1h, anything more is suspect
        ? Math.round(durationMsRaw)
        : null;

    try {
      await prisma.analyticsEvent.create({
        data: {
          visitorId,
          sessionId,
          userId,
          path,
          pathFull: str(body.pathFull, 1000),
          title: str(body.title, 300),
          referrer: cls.referrer,
          referrerHost: cls.referrerHost,
          utmSource: str(body.utmSource, 100),
          utmMedium: str(body.utmMedium, 100),
          utmCampaign: str(body.utmCampaign, 200),
          utmTerm: str(body.utmTerm, 200),
          utmContent: str(body.utmContent, 200),
          country: geo.country,
          region: geo.region,
          city: geo.city,
          browser: ua.browser,
          browserVersion: ua.browserVersion,
          os: ua.os,
          device: ua.device,
          durationMs,
          ipHash: hashIp(ip || "unknown"),
          eventType,
          eventValue,
        },
      });
    } catch (err) {
      app.log.warn({ err }, "[analytics] insert failed");
      // Always return 204 — never surface DB errors to the client tracker.
    }
    return reply.status(204).send();
  });

  /**
   * Editable site navigation. Returns the current published config —
   * always returns a valid shape (defaults if no row exists or stored
   * JSON is malformed) so the public SiteHeader never breaks.
   */
  app.get("/site-nav", async () => {
    const row = await prisma.siteNavConfig.findUnique({
      where: { id: "default" },
    });
    const parsed = row ? parseSiteNavConfig(row.config) : null;
    return { config: parsed ?? defaultSiteNavConfig() };
  });

  /**
   * Compact index of every published marketing page — used by the SEO
   * sitemap to populate `<lastmod>` with each page's actual last-publish
   * timestamp (the single biggest crawler signal for "is this URL still
   * fresh and worth re-crawling?"). Public on purpose.
   */
  app.get("/pages/index", async () => {
    const pages = await prisma.marketingPage.findMany({
      where: { archived: false },
      select: {
        id: true,
        slug: true,
        name: true,
        versions: {
          where: { published: true },
          orderBy: { version: "desc" },
          take: 1,
          select: { updatedAt: true, version: true },
        },
      },
    });
    return {
      pages: pages
        .filter((p) => p.versions.length > 0)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          publishedAt: p.versions[0]!.updatedAt.toISOString(),
          version: p.versions[0]!.version,
        })),
    };
  });

  // ─── SEO meta + IndexNow key (public) ────────────────────────────────

  /**
   * Verification meta tags + the IndexNow key for the public site. The
   * frontend root layout fetches this once at request time (with ISR
   * caching) and emits the meta tags into <head>. The IndexNow key is
   * also exposed here so /.well-known/indexnow.txt can serve it.
   */
  app.get("/seo/meta", async () => {
    const settings = await getAllSettings();
    const key = await getOrCreateIndexNowKey();
    return {
      verifications: {
        google: settings[SETTING_KEYS.verifyGoogle] ?? null,
        bing: settings[SETTING_KEYS.verifyBing] ?? null,
        yandex: settings[SETTING_KEYS.verifyYandex] ?? null,
        pinterest: settings[SETTING_KEYS.verifyPinterest] ?? null,
        meta: settings[SETTING_KEYS.verifyMeta] ?? null,
      },
      indexNowKey: key,
    };
  });

  // ─── Journal (public) ────────────────────────────────────────────────

  /**
   * Compact index of every published article — used by the SEO sitemap
   * and by /llms-full.txt to discover the full list of public posts
   * without paginating through the main /journal endpoint.
   */
  app.get("/journal/index", async () => {
    const articles = await prisma.article.findMany({
      where: { status: "published" },
      select: {
        slug: true,
        title: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: [{ publishedAt: "desc" }],
    });
    return { articles };
  });

  /** Paginated public list of published articles (newest first). */
  app.get("/journal", async (request) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const limit = Math.min(
      50,
      Math.max(1, Number(q.limit) || 24),
    );
    const offset = Math.max(0, Number(q.offset) || 0);
    const category =
      typeof q.category === "string" && q.category.trim()
        ? q.category.trim()
        : null;
    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where: {
          status: "published",
          ...(category ? { category } : {}),
        },
        orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          slug: true,
          title: true,
          subtitle: true,
          excerpt: true,
          category: true,
          tags: true,
          heroImageUrl: true,
          heroImageAlt: true,
          featured: true,
          publishedAt: true,
          updatedAt: true,
          author: {
            select: { slug: true, name: true, avatarUrl: true, role: true },
          },
        },
      }),
      prisma.article.count({
        where: {
          status: "published",
          ...(category ? { category } : {}),
        },
      }),
    ]);
    const categories = await prisma.article.findMany({
      where: { status: "published", category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    return {
      articles,
      total,
      limit,
      offset,
      categories: categories
        .map((c) => c.category)
        .filter((c): c is string => !!c),
    };
  });

  /** Fetch a single published article by slug. 404 if unpublished. */
  app.get<{ Params: { slug: string } }>(
    "/journal/:slug",
    async (request, reply) => {
      const slug = request.params.slug;
      if (!slugRe.test(slug)) {
        return reply.status(400).send({ error: "Invalid slug" });
      }
      const article = await prisma.article.findFirst({
        where: { slug, status: "published" },
        include: {
          author: {
            select: {
              slug: true,
              name: true,
              role: true,
              bio: true,
              avatarUrl: true,
            },
          },
        },
      });
      if (!article) return reply.status(404).send({ error: "Article not found" });
      const schema = parsePageSchema(article.body);
      if (!schema) {
        return reply.status(500).send({ error: "Invalid article body" });
      }
      // 3 most recent siblings (any category) for the "Keep reading" strip.
      const related = await prisma.article.findMany({
        where: {
          status: "published",
          NOT: { id: article.id },
        },
        orderBy: [{ publishedAt: "desc" }],
        take: 3,
        select: {
          slug: true,
          title: true,
          excerpt: true,
          heroImageUrl: true,
          heroImageAlt: true,
          category: true,
          publishedAt: true,
          author: { select: { name: true, avatarUrl: true } },
        },
      });
      return { article: { ...article, body: schema }, related };
    },
  );

  app.get("/pages/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!slugRe.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }
    const page = await prisma.marketingPage.findFirst({
      where: { slug, archived: false },
      include: {
        versions: {
          where: { published: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!page || page.versions.length === 0) {
      return reply.status(404).send({ error: "Page not found" });
    }
    const v = page.versions[0]!;
    const schema = parsePageSchema(v.schema);
    if (!schema) {
      return reply.status(500).send({ error: "Invalid page definition" });
    }
    return {
      page: {
        id: page.id,
        slug: page.slug,
        name: page.name,
        description: page.description,
      },
      version: { id: v.id, version: v.version, label: v.label, schema },
    };
  });

  app.get("/airports", async (request) => {
    const { q } = (request.query as { q?: string }) ?? {};
    const term = (q ?? "").trim();
    if (term.length === 0) {
      const rows = await prisma.airport.findMany({
        where: { active: true },
        orderBy: [{ country: "asc" }, { city: "asc" }],
        take: 50,
      });
      return { airports: rows };
    }
    const rows = await prisma.airport.findMany({
      where: {
        active: true,
        OR: [
          { iata: { contains: term, mode: "insensitive" } },
          { icao: { contains: term, mode: "insensitive" } },
          { name: { contains: term, mode: "insensitive" } },
          { city: { contains: term, mode: "insensitive" } },
          { region: { contains: term, mode: "insensitive" } },
          { country: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 100,
    });
    rows.sort((a, b) => rankAirport(term, b) - rankAirport(term, a));
    return { airports: rows.slice(0, 20) };
  });

  app.get("/destinations", async (request) => {
    const { q, type } = (request.query as { q?: string; type?: string }) ?? {};
    const term = (q ?? "").trim();
    const typeFilter: { type?: DestinationType } = {};
    if (type && ["COUNTRY", "REGION", "CITY", "AREA", "PARK", "RESORT", "VENUE"].includes(type)) {
      typeFilter.type = type as DestinationType;
    }
    if (term.length === 0) {
      const rows = await prisma.destination.findMany({
        where: { active: true, ...typeFilter },
        orderBy: [{ name: "asc" }],
        take: 50,
      });
      return { destinations: rows };
    }
    const rows = await prisma.destination.findMany({
      where: {
        active: true,
        ...typeFilter,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { slug: { contains: term, mode: "insensitive" } },
          { country: { contains: term, mode: "insensitive" } },
          { region: { contains: term, mode: "insensitive" } },
          { aliases: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 100,
    });
    rows.sort((a, b) => rankDestination(term, b) - rankDestination(term, a));
    return { destinations: rows.slice(0, 30) };
  });

  app.get("/intake-forms/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!slugRe.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }
    const form = await prisma.intakeForm.findFirst({
      where: { slug, archived: false },
      include: {
        versions: {
          where: { published: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!form || form.versions.length === 0) {
      return reply.status(404).send({ error: "Form not found" });
    }
    const v = form.versions[0]!;
    const schema = parseIntakeFormSchema(v.schema);
    if (!schema) {
      return reply.status(500).send({ error: "Invalid form definition" });
    }
    return {
      form: {
        id: form.id,
        slug: form.slug,
        name: form.name,
        description: form.description,
      },
      version: {
        id: v.id,
        version: v.version,
        label: v.label,
        schema,
      },
    };
  });

  app.post("/intake-forms/:slug/submit", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!slugRe.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }

    const body = request.body as {
      email?: string;
      responses?: Record<string, unknown>;
      website?: string;
    };
    if (body.website) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: "Valid email is required" });
    }
    if (!body.responses || typeof body.responses !== "object") {
      return reply.status(400).send({ error: "responses object required" });
    }

    const form = await prisma.intakeForm.findFirst({
      where: { slug, archived: false },
      include: {
        versions: {
          where: { published: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!form || form.versions.length === 0) {
      return reply.status(404).send({ error: "Form not found" });
    }
    const v = form.versions[0]!;
    const schema = parseIntakeFormSchema(v.schema);
    if (!schema) {
      return reply.status(500).send({ error: "Invalid form definition" });
    }

    const raw = body.responses as Record<string, unknown>;
    const responses = sanitizeResponses(schema, raw);
    const err = validateIntakeResponses(schema, responses);
    if (err) {
      return reply.status(400).send({ error: err });
    }

    const ip =
      clientIpFromRequest(request.headers) ||
      (request as { ip?: string }).ip ||
      "unknown";
    const rl = checkIntakeSubmitRateLimit(ip);
    if (!rl.ok) {
      return reply
        .status(429)
        .header("Retry-After", String(rl.retryAfterSec ?? 3600))
        .send({ error: "Too many submissions. Please try again later." });
    }

    const session = await getSession(request);
    const clientId = session?.user?.id ?? null;

    const row = await prisma.intakeSubmission.create({
      data: {
        formId: form.id,
        formVersionId: v.id,
        email,
        responses: responses as object,
        clientId: clientId ?? undefined,
      },
    });

    const summaryLines = summarizeIntakeResponses(schema, responses);
    void sendIntakeNotificationEmail({
      formName: form.name,
      formSlug: form.slug,
      submitterEmail: email,
      submissionId: row.id,
      summaryLines,
    });

    return reply.status(201).send({
      id: row.id,
      message: "Thank you — we received your trip intake.",
    });
  });
};
