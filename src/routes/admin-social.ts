/**
 * Admin endpoints for the social-post generator.
 *
 * Surface:
 *   GET    /                       list (filters: status, platform, q)
 *   POST   /generate               draft caption/script/etc with OpenAI (returns draft only, doesn't persist)
 *   POST   /                       create a post (typically from a generated draft)
 *   GET    /campaigns              list pre-built campaign templates
 *   GET    /:id                    get one (with images)
 *   PATCH  /:id                    update editable fields
 *   POST   /:id/images             attach an image (uploaded bytes, AI-generated, or external URL)
 *   POST   /:id/images/generate    generate an image with OpenAI and attach it
 *   PATCH  /:id/images/:imageId    update an image (alt, slideCaption, position)
 *   DELETE /:id/images/:imageId    remove an image
 *   DELETE /:id                    delete the post
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  ObjectStorageNotConfigured,
  isObjectStorageConfigured,
  putObject,
} from "../lib/object-storage.js";
import {
  OpenAINotConfigured,
  generateImage,
  isOpenAIConfigured,
} from "../lib/openai.js";
import {
  CAMPAIGN_TEMPLATES,
  PLATFORMS,
  defaultContentType,
  imageSizeFor,
  type Platform,
} from "../lib/social-brand.js";
import {
  generateSocialDraft,
  type GenerateBrief,
} from "../lib/social-generate.js";

function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function strArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x): x is string => x.length > 0)
    .map((x) => (x.startsWith("#") ? x : `#${x}`));
}

function parseContentType(
  v: unknown,
  platform: Platform,
): "static" | "carousel" | "video" | "story" {
  const allowed = ["static", "carousel", "video", "story"] as const;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
    return v as (typeof allowed)[number];
  }
  return defaultContentType(platform);
}

function safeBody(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

export const adminSocialRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  // ─── Campaign templates ──────────────────────────────────────────────
  app.get("/campaigns", async () => {
    return {
      campaigns: CAMPAIGN_TEMPLATES,
      platforms: PLATFORMS.map((p) => ({
        value: p,
        contentType: defaultContentType(p),
      })),
      openaiConfigured: isOpenAIConfigured(),
      imageGenConfigured: isOpenAIConfigured() && isObjectStorageConfigured(),
    };
  });

  // ─── List ────────────────────────────────────────────────────────────
  app.get("/", async (request) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const status = strOrNull(q.status);
    const platform = strOrNull(q.platform);
    const search = strOrNull(q.q);
    const posts = await prisma.socialPost.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(platform ? { platform } : {}),
        ...(search
          ? {
              OR: [
                { caption: { contains: search, mode: "insensitive" as const } },
                { theme: { contains: search, mode: "insensitive" as const } },
                { destination: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        images: { orderBy: { position: "asc" }, take: 1 },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      take: 200,
    });
    const counts = await prisma.socialPost.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    return {
      posts,
      counts: counts.reduce<Record<string, number>>(
        (acc, row) => ({ ...acc, [row.status]: row._count._all }),
        {},
      ),
    };
  });

  // ─── Get one ─────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const post = await prisma.socialPost.findUnique({
      where: { id: request.params.id },
      include: {
        images: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!post) return reply.status(404).send({ error: "Not found" });
    return { post };
  });

  // ─── Generate (no DB write) ──────────────────────────────────────────
  app.post("/generate", async (request, reply) => {
    if (!isOpenAIConfigured()) {
      return reply
        .status(503)
        .send({ error: "OpenAI is not configured. Set OPENAI_API_KEY on the API service." });
    }
    const body = safeBody(request);
    if (!isPlatform(body.platform)) {
      return reply.status(400).send({ error: "Invalid platform" });
    }
    const platform = body.platform;
    const contentType = parseContentType(body.contentType, platform);
    const brief: GenerateBrief = {
      platform,
      contentType,
      campaignKey: strOrNull(body.campaignKey),
      theme: strOrNull(body.theme),
      destination: strOrNull(body.destination),
      briefing: strOrNull(body.briefing),
      tone: strOrNull(body.tone),
      goal: strOrNull(body.goal),
    };
    try {
      const draft = await generateSocialDraft(brief);
      return { draft, brief };
    } catch (err) {
      if (err instanceof OpenAINotConfigured) {
        return reply.status(503).send({ error: err.message });
      }
      app.log.error({ err }, "social generate failed");
      const msg =
        err instanceof Error ? err.message : "Generation failed";
      return reply.status(502).send({ error: msg });
    }
  });

  // ─── Create from draft (persist) ─────────────────────────────────────
  app.post("/", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const body = safeBody(request);
    if (!isPlatform(body.platform)) {
      return reply.status(400).send({ error: "Invalid platform" });
    }
    const platform = body.platform;
    const contentType = parseContentType(body.contentType, platform);
    const caption = strOrNull(body.caption);
    if (!caption) {
      return reply.status(400).send({ error: "Caption is required" });
    }
    const hashtags = strArrayOrNull(body.hashtags) ?? [];

    const created = await prisma.socialPost.create({
      data: {
        platform,
        contentType,
        campaignKey: strOrNull(body.campaignKey),
        theme: strOrNull(body.theme),
        destination: strOrNull(body.destination),
        briefing: strOrNull(body.briefing),
        tone: strOrNull(body.tone),
        goal: strOrNull(body.goal),
        caption,
        hashtags,
        hook: strOrNull(body.hook),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        script: (body.script ?? null) as any,
        cta: strOrNull(body.cta),
        ctaHref: strOrNull(body.ctaHref),
        status: typeof body.status === "string" ? body.status : "draft",
        createdById: session.user.id,
      },
    });
    return reply.status(201).send({ post: created });
  });

  // ─── Patch editable fields ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = safeBody(request);
    const data: Record<string, unknown> = {};
    if ("caption" in body) data.caption = strOrNull(body.caption) ?? "";
    if ("hashtags" in body) data.hashtags = strArrayOrNull(body.hashtags) ?? [];
    if ("hook" in body) data.hook = strOrNull(body.hook);
    if ("script" in body) data.script = body.script ?? null;
    if ("cta" in body) data.cta = strOrNull(body.cta);
    if ("ctaHref" in body) data.ctaHref = strOrNull(body.ctaHref);
    if ("theme" in body) data.theme = strOrNull(body.theme);
    if ("destination" in body) data.destination = strOrNull(body.destination);
    if ("briefing" in body) data.briefing = strOrNull(body.briefing);
    if ("tone" in body) data.tone = strOrNull(body.tone);
    if ("goal" in body) data.goal = strOrNull(body.goal);
    if ("status" in body && typeof body.status === "string") {
      const allowed = ["draft", "ready", "scheduled", "posted", "archived"];
      if (allowed.includes(body.status)) data.status = body.status;
    }
    if ("scheduledFor" in body) {
      data.scheduledFor =
        typeof body.scheduledFor === "string" && body.scheduledFor
          ? new Date(body.scheduledFor)
          : null;
    }
    if ("postedAt" in body) {
      data.postedAt =
        typeof body.postedAt === "string" && body.postedAt
          ? new Date(body.postedAt)
          : null;
    }
    if ("postedUrl" in body) data.postedUrl = strOrNull(body.postedUrl);
    if ("platform" in body && isPlatform(body.platform)) {
      data.platform = body.platform;
    }
    if ("contentType" in body) {
      const ct = parseContentType(
        body.contentType,
        isPlatform(body.platform) ? body.platform : "instagram_post",
      );
      data.contentType = ct;
    }

    // Convenience: marking as posted stamps postedAt.
    if (data.status === "posted" && !("postedAt" in data)) {
      data.postedAt = new Date();
    }

    try {
      const post = await prisma.socialPost.update({
        where: { id: request.params.id },
        data,
        include: { images: { orderBy: { position: "asc" } } },
      });
      return { post };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // ─── Delete post ─────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    try {
      await prisma.socialPost.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // ─── Attach an image (multipart OR { url }) ──────────────────────────
  app.post<{ Params: { id: string } }>("/:id/images", async (request, reply) => {
    const post = await prisma.socialPost.findUnique({
      where: { id: request.params.id },
    });
    if (!post) return reply.status(404).send({ error: "Not found" });

    const contentType = request.headers["content-type"] ?? "";
    let url: string | null = null;
    let alt: string | null = null;
    let slideCaption: string | null = null;
    let source = "uploaded";

    if (typeof contentType === "string" && contentType.startsWith("multipart/")) {
      if (!isObjectStorageConfigured()) {
        return reply
          .status(503)
          .send({ error: "Object storage is not configured." });
      }
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: "No file uploaded" });
      const buf = await data.toBuffer();
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(data.mimetype)) {
        return reply.status(415).send({ error: `Unsupported type: ${data.mimetype}` });
      }
      try {
        const out = await putObject({
          body: buf,
          filename: data.filename,
          contentType: data.mimetype,
          prefix: "social",
        });
        url = out.url;
      } catch (err) {
        if (err instanceof ObjectStorageNotConfigured) {
          return reply.status(503).send({ error: err.message });
        }
        throw err;
      }
      const fields = (data.fields ?? {}) as Record<string, unknown>;
      const altField = fields.alt;
      const slideField = fields.slideCaption;
      const isPart = (v: unknown): v is { value: unknown } =>
        typeof v === "object" && v !== null && "value" in (v as object);
      if (isPart(altField) && typeof altField.value === "string") {
        alt = altField.value.trim() || null;
      }
      if (isPart(slideField) && typeof slideField.value === "string") {
        slideCaption = slideField.value.trim() || null;
      }
    } else {
      const body = safeBody(request);
      const u = strOrNull(body.url);
      if (!u) return reply.status(400).send({ error: "url required" });
      url = u;
      alt = strOrNull(body.alt);
      slideCaption = strOrNull(body.slideCaption);
      source = "url";
    }

    const existing = await prisma.socialPostImage.count({
      where: { postId: post.id },
    });
    const image = await prisma.socialPostImage.create({
      data: {
        postId: post.id,
        url: url!,
        alt,
        slideCaption,
        source,
        position: existing,
      },
    });
    return reply.status(201).send({ image });
  });

  // ─── Generate an image with OpenAI and attach it ─────────────────────
  app.post<{ Params: { id: string } }>(
    "/:id/images/generate",
    async (request, reply) => {
      if (!isOpenAIConfigured()) {
        return reply
          .status(503)
          .send({ error: "OpenAI is not configured. Set OPENAI_API_KEY." });
      }
      if (!isObjectStorageConfigured()) {
        return reply
          .status(503)
          .send({ error: "Object storage is not configured for image hosting." });
      }
      const post = await prisma.socialPost.findUnique({
        where: { id: request.params.id },
      });
      if (!post) return reply.status(404).send({ error: "Not found" });

      const body = safeBody(request);
      const prompt = strOrNull(body.prompt);
      if (!prompt) return reply.status(400).send({ error: "prompt required" });
      const size = imageSizeFor(post.platform as Platform);
      try {
        const out = await generateImage({ prompt, size });
        const stored = await putObject({
          body: out.bytes,
          filename: "ai.png",
          contentType: out.contentType,
          prefix: "social/ai",
        });
        const existing = await prisma.socialPostImage.count({
          where: { postId: post.id },
        });
        const image = await prisma.socialPostImage.create({
          data: {
            postId: post.id,
            url: stored.url,
            alt: strOrNull(body.alt),
            slideCaption: strOrNull(body.slideCaption),
            source: "ai_generated",
            prompt,
            position: existing,
          },
        });
        return reply.status(201).send({ image });
      } catch (err) {
        if (err instanceof OpenAINotConfigured) {
          return reply.status(503).send({ error: err.message });
        }
        if (err instanceof ObjectStorageNotConfigured) {
          return reply.status(503).send({ error: err.message });
        }
        app.log.error({ err }, "image generate failed");
        const msg = err instanceof Error ? err.message : "Image generation failed";
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // ─── Patch image ─────────────────────────────────────────────────────
  app.patch<{ Params: { id: string; imageId: string } }>(
    "/:id/images/:imageId",
    async (request, reply) => {
      const body = safeBody(request);
      const data: Record<string, unknown> = {};
      if ("alt" in body) data.alt = strOrNull(body.alt);
      if ("slideCaption" in body) data.slideCaption = strOrNull(body.slideCaption);
      if ("position" in body) {
        const n = Number(body.position);
        if (Number.isFinite(n)) data.position = Math.max(0, Math.round(n));
      }
      try {
        const image = await prisma.socialPostImage.update({
          where: { id: request.params.imageId },
          data,
        });
        return { image };
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // ─── Delete image ────────────────────────────────────────────────────
  app.delete<{ Params: { id: string; imageId: string } }>(
    "/:id/images/:imageId",
    async (request, reply) => {
      try {
        await prisma.socialPostImage.delete({
          where: { id: request.params.imageId },
        });
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );
};
