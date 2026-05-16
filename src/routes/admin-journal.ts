/**
 * Admin CRUD for the journal — authors and articles. Article bodies
 * reuse the PageSchema JSON shape (same blocks as marketing pages), so
 * admins author posts in the visual page builder they already know.
 *
 * Surface (under /api/admin):
 *   GET    /authors                  list active + inactive
 *   POST   /authors                  create
 *   GET    /authors/:id              fetch
 *   PATCH  /authors/:id              update
 *   DELETE /authors/:id              delete (404 if author has posts; archive instead)
 *
 *   GET    /articles                 list (?status, ?q, ?authorId)
 *   POST   /articles                 create (defaults to draft with one rich_text block)
 *   GET    /articles/:id             fetch with author
 *   PATCH  /articles/:id             update — full field set + body
 *   DELETE /articles/:id             delete
 *   POST   /articles/:id/duplicate   clone as new draft with " (copy)" suffix
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  PAGE_SCHEMA_VERSION,
  parsePageSchema,
  type PageSchema,
} from "../lib/page-schema.js";

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function safeBody(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x): x is string => x.length > 0);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function uniqueArticleSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 2;
  while (await prisma.article.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix++}`;
    if (suffix > 50) {
      slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
      break;
    }
  }
  return slug;
}

const ALLOWED_STATUS = ["draft", "published", "archived"] as const;
type ArticleStatus = (typeof ALLOWED_STATUS)[number];

function isStatus(v: unknown): v is ArticleStatus {
  return typeof v === "string" && (ALLOWED_STATUS as readonly string[]).includes(v);
}

function emptyArticleBody(): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: `text_${Math.random().toString(36).slice(2, 10)}`,
        type: "rich_text",
        paragraphs: [""],
        maxWidth: "normal",
      },
    ],
  };
}

export const adminJournalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  // ─── Authors ────────────────────────────────────────────────────────
  app.get("/authors", async () => {
    const authors = await prisma.author.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { articles: true } },
      },
    });
    return { authors };
  });

  app.post("/authors", async (request, reply) => {
    const body = safeBody(request);
    const name = strOrNull(body.name);
    if (!name) return reply.status(400).send({ error: "name is required" });
    const slugInput = strOrNull(body.slug) ?? slugify(name);
    if (!slugRe.test(slugInput)) {
      return reply.status(400).send({ error: "slug must be kebab-case" });
    }
    const existing = await prisma.author.findUnique({
      where: { slug: slugInput },
    });
    if (existing) {
      return reply.status(409).send({ error: "slug already in use" });
    }
    const author = await prisma.author.create({
      data: {
        slug: slugInput,
        name,
        email: strOrNull(body.email),
        role: strOrNull(body.role),
        bio: strOrNull(body.bio),
        avatarUrl: strOrNull(body.avatarUrl),
        active: body.active === false ? false : true,
      },
    });
    return reply.status(201).send({ author });
  });

  app.get<{ Params: { id: string } }>("/authors/:id", async (request, reply) => {
    const author = await prisma.author.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { articles: true } } },
    });
    if (!author) return reply.status(404).send({ error: "Not found" });
    return { author };
  });

  app.patch<{ Params: { id: string } }>(
    "/authors/:id",
    async (request, reply) => {
      const body = safeBody(request);
      const data: Record<string, unknown> = {};
      if ("name" in body) {
        const n = strOrNull(body.name);
        if (!n) return reply.status(400).send({ error: "name cannot be empty" });
        data.name = n;
      }
      if ("slug" in body) {
        const s = strOrNull(body.slug);
        if (!s || !slugRe.test(s)) {
          return reply.status(400).send({ error: "slug must be kebab-case" });
        }
        const existing = await prisma.author.findFirst({
          where: { slug: s, NOT: { id: request.params.id } },
        });
        if (existing) {
          return reply.status(409).send({ error: "slug already in use" });
        }
        data.slug = s;
      }
      if ("email" in body) data.email = strOrNull(body.email);
      if ("role" in body) data.role = strOrNull(body.role);
      if ("bio" in body) data.bio = strOrNull(body.bio);
      if ("avatarUrl" in body) data.avatarUrl = strOrNull(body.avatarUrl);
      if ("active" in body) data.active = body.active === true;
      try {
        const author = await prisma.author.update({
          where: { id: request.params.id },
          data,
        });
        return { author };
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/authors/:id",
    async (request, reply) => {
      const articleCount = await prisma.article.count({
        where: { authorId: request.params.id },
      });
      if (articleCount > 0) {
        return reply.status(409).send({
          error: `Author has ${articleCount} article(s). Reassign or delete them first, or set the author to inactive.`,
        });
      }
      try {
        await prisma.author.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  // ─── Articles ───────────────────────────────────────────────────────
  app.get("/articles", async (request) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const status = strOrNull(q.status);
    const authorId = strOrNull(q.authorId);
    const category = strOrNull(q.category);
    const search = strOrNull(q.q);
    const articles = await prisma.article.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(authorId ? { authorId } : {}),
        ...(category ? { category } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                { excerpt: { contains: search, mode: "insensitive" as const } },
                { slug: { contains: search, mode: "insensitive" as const } },
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
      orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { updatedAt: "desc" }],
      include: {
        author: { select: { id: true, slug: true, name: true, avatarUrl: true } },
      },
      take: 200,
    });
    const counts = await prisma.article.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    return {
      articles,
      counts: counts.reduce<Record<string, number>>(
        (acc, row) => ({ ...acc, [row.status]: row._count._all }),
        {},
      ),
    };
  });

  app.post("/articles", async (request, reply) => {
    const body = safeBody(request);
    const title = strOrNull(body.title) ?? "Untitled draft";
    const slugInput =
      strOrNull(body.slug) ?? (slugify(title) || "untitled-draft");
    if (!slugRe.test(slugInput)) {
      return reply.status(400).send({ error: "slug must be kebab-case" });
    }
    let authorId = strOrNull(body.authorId);
    if (!authorId) {
      // Default to the first active author if the caller didn't pick one.
      const author = await prisma.author.findFirst({
        where: { active: true },
        orderBy: { createdAt: "asc" },
      });
      if (!author) {
        return reply.status(400).send({
          error:
            "No active authors exist. Create one in Edit content → Authors first.",
        });
      }
      authorId = author.id;
    }
    const slug = await uniqueArticleSlug(slugInput);
    const bodyJson = body.body ?? emptyArticleBody();
    if (!parsePageSchema(bodyJson)) {
      return reply
        .status(400)
        .send({ error: "Invalid body — must be a PageSchema." });
    }
    const article = await prisma.article.create({
      data: {
        slug,
        title,
        subtitle: strOrNull(body.subtitle),
        excerpt: strOrNull(body.excerpt),
        category: strOrNull(body.category),
        tags: strArr(body.tags),
        heroImageUrl: strOrNull(body.heroImageUrl),
        heroImageAlt: strOrNull(body.heroImageAlt),
        ogImageUrl: strOrNull(body.ogImageUrl),
        metaTitle: strOrNull(body.metaTitle),
        metaDescription: strOrNull(body.metaDescription),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: bodyJson as any,
        status: isStatus(body.status) ? body.status : "draft",
        featured: body.featured === true,
        authorId,
      },
    });
    return reply.status(201).send({ article });
  });

  app.get<{ Params: { id: string } }>(
    "/articles/:id",
    async (request, reply) => {
      const article = await prisma.article.findUnique({
        where: { id: request.params.id },
        include: {
          author: {
            select: {
              id: true,
              slug: true,
              name: true,
              role: true,
              bio: true,
              avatarUrl: true,
              active: true,
            },
          },
        },
      });
      if (!article) return reply.status(404).send({ error: "Not found" });
      return { article };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/articles/:id",
    async (request, reply) => {
      const body = safeBody(request);
      const current = await prisma.article.findUnique({
        where: { id: request.params.id },
      });
      if (!current) return reply.status(404).send({ error: "Not found" });

      const data: Record<string, unknown> = {};
      if ("title" in body) {
        const t = strOrNull(body.title);
        if (!t) return reply.status(400).send({ error: "title cannot be empty" });
        data.title = t;
      }
      if ("slug" in body) {
        const s = strOrNull(body.slug);
        if (!s || !slugRe.test(s)) {
          return reply.status(400).send({ error: "slug must be kebab-case" });
        }
        if (s !== current.slug) {
          const collision = await prisma.article.findFirst({
            where: { slug: s, NOT: { id: current.id } },
          });
          if (collision) {
            return reply.status(409).send({ error: "slug already in use" });
          }
          data.slug = s;
        }
      }
      if ("subtitle" in body) data.subtitle = strOrNull(body.subtitle);
      if ("excerpt" in body) data.excerpt = strOrNull(body.excerpt);
      if ("category" in body) data.category = strOrNull(body.category);
      if ("tags" in body) data.tags = strArr(body.tags);
      if ("heroImageUrl" in body) data.heroImageUrl = strOrNull(body.heroImageUrl);
      if ("heroImageAlt" in body) data.heroImageAlt = strOrNull(body.heroImageAlt);
      if ("ogImageUrl" in body) data.ogImageUrl = strOrNull(body.ogImageUrl);
      if ("metaTitle" in body) data.metaTitle = strOrNull(body.metaTitle);
      if ("metaDescription" in body)
        data.metaDescription = strOrNull(body.metaDescription);
      if ("featured" in body) data.featured = body.featured === true;
      if ("authorId" in body) {
        const aid = strOrNull(body.authorId);
        if (!aid) return reply.status(400).send({ error: "authorId required" });
        const exists = await prisma.author.findUnique({ where: { id: aid } });
        if (!exists) return reply.status(400).send({ error: "Author not found" });
        data.authorId = aid;
      }
      if ("body" in body) {
        if (!parsePageSchema(body.body)) {
          return reply
            .status(400)
            .send({ error: "Invalid body — must be a PageSchema." });
        }
        data.body = body.body;
      }
      if ("status" in body && isStatus(body.status)) {
        data.status = body.status;
        // First publish stamps publishedAt; later edits don't.
        if (body.status === "published" && !current.publishedAt) {
          data.publishedAt = new Date();
        }
      }
      if ("publishedAt" in body) {
        // Explicit override (e.g. backdating a piece).
        if (body.publishedAt === null) data.publishedAt = null;
        else if (typeof body.publishedAt === "string") {
          const d = new Date(body.publishedAt);
          if (!isNaN(d.getTime())) data.publishedAt = d;
        }
      }

      const article = await prisma.article.update({
        where: { id: current.id },
        data,
        include: {
          author: {
            select: { id: true, slug: true, name: true, role: true, bio: true, avatarUrl: true, active: true },
          },
        },
      });
      return { article };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/articles/:id",
    async (request, reply) => {
      try {
        await prisma.article.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/articles/:id/duplicate",
    async (request, reply) => {
      const src = await prisma.article.findUnique({
        where: { id: request.params.id },
      });
      if (!src) return reply.status(404).send({ error: "Not found" });
      const baseSlug = slugify(`${src.title} copy`);
      const slug = await uniqueArticleSlug(baseSlug);
      const copy = await prisma.article.create({
        data: {
          slug,
          title: `${src.title} (copy)`,
          subtitle: src.subtitle,
          excerpt: src.excerpt,
          category: src.category,
          tags: src.tags,
          heroImageUrl: src.heroImageUrl,
          heroImageAlt: src.heroImageAlt,
          ogImageUrl: src.ogImageUrl,
          metaTitle: src.metaTitle,
          metaDescription: src.metaDescription,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          body: src.body as any,
          status: "draft",
          featured: false,
          authorId: src.authorId,
        },
      });
      return reply.status(201).send({ article: copy });
    },
  );
};
