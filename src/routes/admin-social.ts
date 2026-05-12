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
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  ObjectStorageNotConfigured,
  isObjectStorageConfigured,
  putObject,
} from "../lib/object-storage.js";
import {
  AIProviderError,
  configuredImageProviders,
  configuredTextProviders,
  generateImage,
  imageProviderInfo,
  textProviderInfo,
  type ImageProviderName,
  type TextProviderName,
} from "../lib/ai-providers.js";
import {
  estimateAudioDurationSec,
  generateVoiceover,
  isElevenLabsConfigured,
} from "../lib/ai-voice.js";
import {
  aspectForPlatform,
  getHeyGenStatus,
  isHeyGenConfigured,
  scriptToVoiceoverText,
  submitHeyGenVideo,
} from "../lib/ai-video.js";
import {
  CAMPAIGN_TEMPLATES,
  PLATFORMS,
  defaultContentType,
  imageSizeFor,
  type Platform,
} from "../lib/social-brand.js";
import {
  generateSocialDraft,
  generateSocialDraftsCompare,
  resolveProvider,
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

  // ─── Campaign templates + provider config ────────────────────────────
  app.get("/campaigns", async () => {
    const textConfigured = configuredTextProviders();
    const imageConfigured = configuredImageProviders();
    return {
      campaigns: CAMPAIGN_TEMPLATES,
      platforms: PLATFORMS.map((p) => ({
        value: p,
        contentType: defaultContentType(p),
      })),
      textProviders: textProviderInfo(),
      imageProviders: imageProviderInfo(),
      // Convenience flags for the UI.
      textConfigured: textConfigured.length > 0,
      imageGenConfigured: imageConfigured.length > 0 && isObjectStorageConfigured(),
      voiceoverConfigured: isElevenLabsConfigured() && isObjectStorageConfigured(),
      aiVideoConfigured: isHeyGenConfigured() && isObjectStorageConfigured(),
      // Backward-compat flag still used in older UI builds.
      openaiConfigured: textConfigured.includes("openai"),
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
    if (configuredTextProviders().length === 0) {
      return reply.status(503).send({
        error:
          "No AI provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY on the API service.",
      });
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

    // Provider can be: "auto" | "openai" | "anthropic" | "gemini" | "compare"
    const rawProvider = strOrNull(body.provider) ?? "auto";

    try {
      if (rawProvider === "compare") {
        const drafts = await generateSocialDraftsCompare(brief);
        return { compareDrafts: drafts, brief };
      }
      const provider = resolveProvider(
        rawProvider as TextProviderName | "auto",
        brief,
      );
      const out = await generateSocialDraft(brief, provider);
      return {
        draft: out.draft,
        brief,
        provider: out.provider,
        providerLabel: out.providerLabel,
        model: out.model,
      };
    } catch (err) {
      app.log.error({ err }, "social generate failed");
      const msg = err instanceof Error ? err.message : "Generation failed";
      const status = err instanceof AIProviderError ? 502 : 502;
      return reply.status(status).send({ error: msg });
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

  // ─── Generate an image with OpenAI / Gemini and attach it ───────────
  app.post<{ Params: { id: string } }>(
    "/:id/images/generate",
    async (request, reply) => {
      if (configuredImageProviders().length === 0) {
        return reply.status(503).send({
          error:
            "No image generator is configured. Set OPENAI_API_KEY (recommended) or GEMINI_API_KEY.",
        });
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
      const providerReq = strOrNull(body.provider) ?? "auto";
      const provider: ImageProviderName | "auto" =
        providerReq === "openai" || providerReq === "gemini"
          ? (providerReq as ImageProviderName)
          : "auto";
      try {
        const out = await generateImage({ prompt, size, provider });
        const stored = await putObject({
          body: out.bytes,
          filename: out.contentType.includes("png") ? "ai.png" : "ai.jpg",
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
            prompt: `[${out.provider}/${out.model}] ${prompt}`,
            position: existing,
          },
        });
        return reply.status(201).send({
          image,
          provider: out.provider,
          model: out.model,
        });
      } catch (err) {
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

  // ─── Per-scene voiceover (ElevenLabs) ────────────────────────────────
  app.post<{ Params: { id: string; sceneIndex: string } }>(
    "/:id/scenes/:sceneIndex/voiceover",
    async (request, reply) => {
      if (!isElevenLabsConfigured()) {
        return reply.status(503).send({
          error: "ElevenLabs is not configured. Set ELEVENLABS_API_KEY.",
        });
      }
      if (!isObjectStorageConfigured()) {
        return reply
          .status(503)
          .send({ error: "Object storage is not configured for audio hosting." });
      }
      const post = await prisma.socialPost.findUnique({
        where: { id: request.params.id },
      });
      if (!post) return reply.status(404).send({ error: "Not found" });
      const idx = Number(request.params.sceneIndex);
      if (!Number.isFinite(idx) || idx < 0) {
        return reply.status(400).send({ error: "Invalid scene index" });
      }

      const script = post.script as Record<string, unknown> | null;
      const scenes = Array.isArray(script?.scenes) ? script.scenes : null;
      if (!scenes || !scenes[idx] || typeof scenes[idx] !== "object") {
        return reply.status(400).send({ error: "Scene does not exist" });
      }
      const scene = scenes[idx] as Record<string, unknown>;
      const body = safeBody(request);
      const text =
        strOrNull(body.text) ??
        (typeof scene.voiceover === "string" ? scene.voiceover.trim() : "");
      if (!text) {
        return reply
          .status(400)
          .send({ error: "Scene has no voiceover text." });
      }
      const voiceId = strOrNull(body.voiceId);
      try {
        const out = await generateVoiceover({
          text,
          voiceId: voiceId ?? undefined,
        });
        const stored = await putObject({
          body: out.bytes,
          filename: "voiceover.mp3",
          contentType: out.contentType,
          prefix: "social/voiceover",
        });
        // Splice the audio metadata back into the scene JSON.
        const dur = estimateAudioDurationSec(out.bytes.length);
        const newScenes = scenes.slice();
        newScenes[idx] = {
          ...scene,
          audioUrl: stored.url,
          audioDurationSec: dur,
          audioVoiceId: out.voiceId,
          audioModel: out.modelId,
          audioText: text,
        };
        const newScript = { ...(script ?? {}), scenes: newScenes };
        const updated = await prisma.socialPost.update({
          where: { id: post.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { script: newScript as any },
          include: { images: { orderBy: { position: "asc" } } },
        });
        return { post: updated, audioUrl: stored.url };
      } catch (err) {
        app.log.error({ err }, "voiceover generate failed");
        const msg =
          err instanceof Error ? err.message : "Voiceover generation failed";
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // Remove a scene's voiceover (does not delete the R2 object).
  app.delete<{ Params: { id: string; sceneIndex: string } }>(
    "/:id/scenes/:sceneIndex/voiceover",
    async (request, reply) => {
      const post = await prisma.socialPost.findUnique({
        where: { id: request.params.id },
      });
      if (!post) return reply.status(404).send({ error: "Not found" });
      const idx = Number(request.params.sceneIndex);
      const script = post.script as Record<string, unknown> | null;
      const scenes = Array.isArray(script?.scenes) ? script.scenes : null;
      if (!scenes || !scenes[idx] || typeof scenes[idx] !== "object") {
        return reply.status(400).send({ error: "Scene does not exist" });
      }
      const scene = scenes[idx] as Record<string, unknown>;
      const cleaned: Record<string, unknown> = { ...scene };
      delete cleaned.audioUrl;
      delete cleaned.audioDurationSec;
      delete cleaned.audioVoiceId;
      delete cleaned.audioModel;
      delete cleaned.audioText;
      const newScenes = scenes.slice();
      newScenes[idx] = cleaned;
      const newScript = { ...(script ?? {}), scenes: newScenes };
      const updated = await prisma.socialPost.update({
        where: { id: post.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { script: newScript as any },
        include: { images: { orderBy: { position: "asc" } } },
      });
      return { post: updated };
    },
  );

  // ─── AI avatar video (HeyGen) ────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/:id/video/generate",
    async (request, reply) => {
      if (!isHeyGenConfigured()) {
        return reply.status(503).send({
          error: "HeyGen is not configured. Set HEYGEN_API_KEY.",
        });
      }
      if (!isObjectStorageConfigured()) {
        return reply
          .status(503)
          .send({ error: "Object storage is not configured for video hosting." });
      }
      const post = await prisma.socialPost.findUnique({
        where: { id: request.params.id },
      });
      if (!post) return reply.status(404).send({ error: "Not found" });
      const body = safeBody(request);
      const scriptText =
        strOrNull(body.script) ?? scriptToVoiceoverText(post.script);
      if (!scriptText) {
        return reply
          .status(400)
          .send({ error: "No voiceover lines in this post's script." });
      }
      const aspect = aspectForPlatform(post.platform);
      try {
        const submitted = await submitHeyGenVideo({
          script: scriptText,
          aspect,
          avatarId: strOrNull(body.avatarId) ?? undefined,
          voiceId: strOrNull(body.voiceId) ?? undefined,
        });
        const aiVideo = {
          provider: "heygen",
          jobId: submitted.videoId,
          status: "processing",
          videoUrl: null,
          thumbnailUrl: null,
          avatarId: submitted.avatarId,
          voiceId: submitted.voiceId,
          durationSec: null,
          errorMessage: null,
          submittedAt: new Date().toISOString(),
          readyAt: null,
          script: scriptText,
        };
        const updated = await prisma.socialPost.update({
          where: { id: post.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { aiVideo: aiVideo as any },
          include: { images: { orderBy: { position: "asc" } } },
        });
        return { post: updated };
      } catch (err) {
        app.log.error({ err }, "heygen submit failed");
        const msg = err instanceof Error ? err.message : "HeyGen submit failed";
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // Poll HeyGen for status. If completed, mirror the video into R2 and
  // record the final URL so the player loads from our domain (and we
  // aren't dependent on HeyGen's CDN URLs which expire).
  app.get<{ Params: { id: string } }>(
    "/:id/video/status",
    async (request, reply) => {
      const post = await prisma.socialPost.findUnique({
        where: { id: request.params.id },
      });
      if (!post) return reply.status(404).send({ error: "Not found" });
      const current = (post.aiVideo as Record<string, unknown> | null) ?? null;
      const jobId = current?.jobId;
      if (!jobId || typeof jobId !== "string") {
        return reply.status(400).send({ error: "No video job to poll." });
      }
      // Already done — just echo what we have.
      if (current?.status === "ready" || current?.status === "failed") {
        return { aiVideo: current };
      }
      try {
        const s = await getHeyGenStatus(jobId);
        if (s.status === "completed" && s.videoUrl) {
          // Mirror to R2 so it survives HeyGen's URL expiration.
          let mirroredUrl = s.videoUrl;
          try {
            const r = await fetch(s.videoUrl);
            if (r.ok) {
              const buf = Buffer.from(await r.arrayBuffer());
              const stored = await putObject({
                body: buf,
                filename: "heygen.mp4",
                contentType: r.headers.get("content-type") || "video/mp4",
                prefix: "social/video",
              });
              mirroredUrl = stored.url;
            }
          } catch (err) {
            app.log.warn({ err }, "heygen mirror failed; falling back to remote URL");
          }
          const aiVideo = {
            ...current,
            status: "ready",
            videoUrl: mirroredUrl,
            thumbnailUrl: s.thumbnailUrl,
            durationSec: s.durationSec,
            readyAt: new Date().toISOString(),
          };
          const updated = await prisma.socialPost.update({
            where: { id: post.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { aiVideo: aiVideo as any },
          });
          return { aiVideo: updated.aiVideo };
        }
        if (s.status === "failed") {
          const aiVideo = {
            ...current,
            status: "failed",
            errorMessage: s.errorMessage,
            readyAt: new Date().toISOString(),
          };
          const updated = await prisma.socialPost.update({
            where: { id: post.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { aiVideo: aiVideo as any },
          });
          return { aiVideo: updated.aiVideo };
        }
        // Still pending / processing — leave DB alone.
        return {
          aiVideo: {
            ...current,
            status: s.status === "pending" ? "pending" : "processing",
          },
        };
      } catch (err) {
        app.log.error({ err }, "heygen status check failed");
        const msg =
          err instanceof Error ? err.message : "HeyGen status check failed";
        return reply.status(502).send({ error: msg });
      }
    },
  );

  // Clear the AI video state from a post (does not delete the R2 object).
  app.delete<{ Params: { id: string } }>(
    "/:id/video",
    async (request, reply) => {
      try {
        const updated = await prisma.socialPost.update({
          where: { id: request.params.id },
          data: { aiVideo: Prisma.DbNull },
          include: { images: { orderBy: { position: "asc" } } },
        });
        return { post: updated };
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );
};
