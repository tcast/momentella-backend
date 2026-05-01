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
