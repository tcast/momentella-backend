/**
 * Admin SEO surface — verification meta tags + IndexNow ops.
 *
 * Routes (all under /api/admin/seo):
 *   GET    /                       summary: settings + indexnow key + last submissions
 *   PATCH  /                       update one or more verification settings
 *   POST   /indexnow/submit        manually submit URLs to IndexNow
 *   POST   /indexnow/rotate-key    rotate the IndexNow key (rare)
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  getAllSettings,
  getOrCreateIndexNowKey,
  setSetting,
  SETTING_KEYS,
} from "../lib/site-settings.js";
import { submitIndexNow } from "../lib/indexnow.js";

function safeBody(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Setting keys the admin UI is allowed to write to. */
const ALLOWED_KEYS = new Set<string>([
  SETTING_KEYS.verifyGoogle,
  SETTING_KEYS.verifyBing,
  SETTING_KEYS.verifyYandex,
  SETTING_KEYS.verifyPinterest,
  SETTING_KEYS.verifyMeta,
]);

export const adminSeoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  app.get("/", async () => {
    const [settings, key, logs, lastSubmission] = await Promise.all([
      getAllSettings(),
      getOrCreateIndexNowKey(),
      prisma.indexNowLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.indexNowLog.findFirst({
        where: { status: { in: [200, 202] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      settings,
      indexNow: {
        key,
        keyFileUrl: `/.well-known/indexnow.txt`,
        lastSuccessfulAt: lastSubmission?.createdAt ?? null,
        recentSubmissions: logs,
      },
    };
  });

  app.patch("/", async (request, reply) => {
    const body = safeBody(request);
    const updates: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (typeof value !== "string" && value !== null) continue;
      updates[key] = value === null ? null : strOrNull(value);
    }
    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No valid settings to update." });
    }
    await Promise.all(
      Object.entries(updates).map(([k, v]) => setSetting(k, v)),
    );
    const settings = await getAllSettings();
    return { settings };
  });

  app.post("/indexnow/submit", async (request, reply) => {
    const body = safeBody(request);
    const urls = Array.isArray(body.urls)
      ? body.urls.filter((u): u is string => typeof u === "string")
      : [];
    if (urls.length === 0) {
      return reply.status(400).send({ error: "Provide urls: string[]." });
    }
    const result = await submitIndexNow(urls, "manual");
    return result;
  });

  app.post("/indexnow/rotate-key", async () => {
    const fresh = randomBytes(16).toString("hex");
    await setSetting(SETTING_KEYS.indexNowKey, fresh);
    return { key: fresh };
  });
};
