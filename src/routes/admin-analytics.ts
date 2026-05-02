/**
 * Admin analytics queries. All endpoints accept ?range=Nd (24h, 7d,
 * 30d, 90d) — defaults to 7d. The dashboard hits these in parallel.
 */

import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";

type Range = "24h" | "7d" | "30d" | "90d";

function parseRange(raw: unknown): Range {
  if (raw === "24h" || raw === "30d" || raw === "90d") return raw;
  return "7d";
}

function rangeStart(range: Range): Date {
  const now = Date.now();
  const ms =
    range === "24h"
      ? 24 * 3600_000
      : range === "30d"
        ? 30 * 86400_000
        : range === "90d"
          ? 90 * 86400_000
          : 7 * 86400_000;
  return new Date(now - ms);
}

/** Group-by truncation — hourly for 24h, daily for everything else. */
function bucketUnit(range: Range): "hour" | "day" {
  return range === "24h" ? "hour" : "day";
}

export const adminAnalyticsRoutes: FastifyPluginAsync = async (app) => {
  // Mirror the admin-only guard from adminRoutes — these are mounted on
  // a separate prefix so the hook doesn't carry over.
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  /** Top-level KPIs for the selected range. */
  app.get("/summary", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);

    const [totals, prevTotals] = await Promise.all([
      prisma.analyticsEvent.aggregate({
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Same-length window immediately before, for delta % comparisons.
      prisma.analyticsEvent.aggregate({
        where: {
          createdAt: {
            gte: new Date(since.getTime() - (Date.now() - since.getTime())),
            lt: since,
          },
        },
        _count: { _all: true },
      }),
    ]);

    const [uniqVisitors, uniqSessions, uniqPrev] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: since } },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: since } },
        distinct: ["sessionId"],
        select: { sessionId: true },
      }),
      prisma.analyticsEvent.findMany({
        where: {
          createdAt: {
            gte: new Date(since.getTime() - (Date.now() - since.getTime())),
            lt: since,
          },
        },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }),
    ]);

    // Bounce: sessions with exactly one event.
    const sessionEventCounts = await prisma.$queryRaw<
      Array<{ sessionId: string; n: bigint }>
    >`SELECT "sessionId", COUNT(*)::bigint AS n
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY "sessionId"`;
    const bounced = sessionEventCounts.filter((s) => Number(s.n) === 1).length;
    const bounceRate =
      sessionEventCounts.length > 0
        ? bounced / sessionEventCounts.length
        : 0;

    // Avg session duration in seconds. Approximate via (max(createdAt) -
    // min(createdAt)) per session.
    const sessionSpans = await prisma.$queryRaw<
      Array<{ span: number }>
    >`SELECT EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt")))::float AS span
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY "sessionId"`;
    const avgSessionSec =
      sessionSpans.length > 0
        ? sessionSpans.reduce((acc, s) => acc + (Number(s.span) || 0), 0) /
          sessionSpans.length
        : 0;

    return {
      range,
      since: since.toISOString(),
      pageviews: totals._count._all,
      pageviewsPrev: prevTotals._count._all,
      uniqueVisitors: uniqVisitors.length,
      uniqueVisitorsPrev: uniqPrev.length,
      sessions: uniqSessions.length,
      bounceRate,
      avgSessionSec: Math.round(avgSessionSec),
    };
  });

  /** Time-series of pageviews + unique visitors per day (or hour for 24h). */
  app.get("/timeseries", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const unit = bucketUnit(range);

    const rows = await prisma.$queryRaw<
      Array<{ bucket: Date; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT date_trunc(${unit}, "createdAt") AS bucket,
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
       WHERE "createdAt" >= ${since}
       GROUP BY 1
       ORDER BY 1 ASC
    `);

    return {
      range,
      unit,
      points: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        pageviews: Number(r.pageviews),
        visitors: Number(r.visitors),
      })),
    };
  });

  /** Top N pages by pageviews. */
  app.get("/top-pages", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const rows = await prisma.$queryRaw<
      Array<{ path: string; pageviews: bigint; visitors: bigint }>
    >`SELECT "path", COUNT(*)::bigint AS pageviews, COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY "path"
        ORDER BY pageviews DESC
        LIMIT 25`;
    return rows.map((r) => ({
      path: r.path,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  /** Top sources — utm_source if present, else referrerHost, else "(direct)". */
  app.get("/top-sources", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const rows = await prisma.$queryRaw<
      Array<{ source: string; pageviews: bigint; visitors: bigint }>
    >`SELECT
          COALESCE(NULLIF("utmSource", ''), "referrerHost", '(direct)') AS source,
          COUNT(*)::bigint AS pageviews,
          COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY source
        ORDER BY pageviews DESC
        LIMIT 25`;
    return rows.map((r) => ({
      source: r.source,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  /** Top referring hosts (excluding self / direct). */
  app.get("/top-referrers", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const rows = await prisma.$queryRaw<
      Array<{ host: string; pageviews: bigint; visitors: bigint }>
    >`SELECT "referrerHost" AS host,
              COUNT(*)::bigint AS pageviews,
              COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
        WHERE "createdAt" >= ${since}
          AND "referrerHost" IS NOT NULL
        GROUP BY host
        ORDER BY pageviews DESC
        LIMIT 25`;
    return rows.map((r) => ({
      host: r.host,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  /** Country breakdown. Empty country shown as "(unknown)". */
  app.get("/top-countries", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const rows = await prisma.$queryRaw<
      Array<{ country: string; pageviews: bigint; visitors: bigint }>
    >`SELECT COALESCE(NULLIF("country", ''), '(unknown)') AS country,
              COUNT(*)::bigint AS pageviews,
              COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY country
        ORDER BY pageviews DESC
        LIMIT 25`;
    return rows.map((r) => ({
      country: r.country,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  /** Device + browser breakdown. */
  app.get("/devices", async (request) => {
    const range = parseRange((request.query as { range?: string }).range);
    const since = rangeStart(range);
    const [devices, browsers, oses] = await Promise.all([
      prisma.$queryRaw<
        Array<{ key: string; n: bigint }>
      >`SELECT COALESCE(NULLIF("device", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
         FROM analytics_event WHERE "createdAt" >= ${since} GROUP BY key ORDER BY n DESC LIMIT 10`,
      prisma.$queryRaw<
        Array<{ key: string; n: bigint }>
      >`SELECT COALESCE(NULLIF("browser", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
         FROM analytics_event WHERE "createdAt" >= ${since} GROUP BY key ORDER BY n DESC LIMIT 10`,
      prisma.$queryRaw<
        Array<{ key: string; n: bigint }>
      >`SELECT COALESCE(NULLIF("os", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
         FROM analytics_event WHERE "createdAt" >= ${since} GROUP BY key ORDER BY n DESC LIMIT 10`,
    ]);
    return {
      devices: devices.map((r) => ({ key: r.key, n: Number(r.n) })),
      browsers: browsers.map((r) => ({ key: r.key, n: Number(r.n) })),
      oses: oses.map((r) => ({ key: r.key, n: Number(r.n) })),
    };
  });

  /** Recent live events for the in-page activity feed. */
  app.get("/recent", async () => {
    const rows = await prisma.analyticsEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        path: true,
        country: true,
        city: true,
        device: true,
        browser: true,
        referrerHost: true,
        utmSource: true,
        userId: true,
        user: { select: { name: true, email: true } },
        createdAt: true,
      },
    });
    return rows;
  });
};
