/**
 * Admin CRUD for the reusable page-block library.
 *
 * Surface (all under /api/admin/saved-blocks):
 *   GET    /                  list (filter: ?blockType=, ?category=, ?q=)
 *   POST   /                  create from a {name, blockType, block, …}
 *   GET    /:id               fetch one
 *   PATCH  /:id               rename / recategorize / replace block JSON
 *   DELETE /:id               remove
 *
 * The `block` column holds the full PageBlock JSON. On read, we don't
 * validate the embedded schema (the page builder reads its own types and
 * the renderer is forgiving). On write we just sanity-check that `block`
 * is an object and `block.type` matches what the caller declared.
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";

function safeBody(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Allowed block types — kept in sync with `page-schema.ts` by hand. */
const VALID_BLOCK_TYPES = new Set([
  "hero",
  "editorial_intro",
  "feature_tiles",
  "process_steps",
  "testimonial",
  "cta_split",
  "rich_text",
  "image",
  "spacer",
  "intake_form",
  "products_grid",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export const adminSavedBlocksRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  // ── List ────────────────────────────────────────────────────────────
  app.get("/", async (request) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const blockType = strOrNull(q.blockType);
    const category = strOrNull(q.category);
    const search = strOrNull(q.q);
    const blocks = await prisma.savedBlock.findMany({
      where: {
        ...(blockType ? { blockType } : {}),
        ...(category ? { category } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                {
                  description: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  category: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      take: 200,
    });
    // Aggregate the distinct (non-null) categories so the UI can render a
    // category filter / picker without an extra round-trip.
    const distinctCategories = await prisma.savedBlock.findMany({
      distinct: ["category"],
      where: { category: { not: null } },
      select: { category: true },
      orderBy: { category: "asc" },
    });
    const categories = distinctCategories
      .map((r) => r.category)
      .filter((c): c is string => !!c);
    return { blocks, categories };
  });

  // ── Get one ─────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const block = await prisma.savedBlock.findUnique({
      where: { id: request.params.id },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    if (!block) return reply.status(404).send({ error: "Not found" });
    return { block };
  });

  // ── Create ──────────────────────────────────────────────────────────
  app.post("/", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user)
      return reply.status(401).send({ error: "Unauthorized" });

    const body = safeBody(request);
    const name = strOrNull(body.name);
    if (!name) {
      return reply.status(400).send({ error: "name is required" });
    }
    const blockType = strOrNull(body.blockType);
    if (!blockType || !VALID_BLOCK_TYPES.has(blockType)) {
      return reply.status(400).send({ error: "Invalid blockType" });
    }
    if (!isPlainObject(body.block)) {
      return reply.status(400).send({ error: "block must be an object" });
    }
    const innerType = (body.block as Record<string, unknown>).type;
    if (innerType !== blockType) {
      return reply.status(400).send({
        error: `block.type (${innerType}) does not match blockType (${blockType})`,
      });
    }

    const created = await prisma.savedBlock.create({
      data: {
        name,
        description: strOrNull(body.description),
        category: strOrNull(body.category),
        blockType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        block: body.block as any,
        createdById: session.user.id,
      },
    });
    return reply.status(201).send({ block: created });
  });

  // ── Update ──────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = safeBody(request);
    const data: Record<string, unknown> = {};
    if ("name" in body) {
      const n = strOrNull(body.name);
      if (!n) return reply.status(400).send({ error: "name cannot be empty" });
      data.name = n;
    }
    if ("description" in body) data.description = strOrNull(body.description);
    if ("category" in body) data.category = strOrNull(body.category);
    if ("block" in body) {
      if (!isPlainObject(body.block)) {
        return reply.status(400).send({ error: "block must be an object" });
      }
      data.block = body.block;
      const innerType = (body.block as Record<string, unknown>).type;
      if (typeof innerType === "string" && VALID_BLOCK_TYPES.has(innerType)) {
        data.blockType = innerType;
      }
    }
    try {
      const block = await prisma.savedBlock.update({
        where: { id: request.params.id },
        data,
      });
      return { block };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // ── Delete ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    try {
      await prisma.savedBlock.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });
};
