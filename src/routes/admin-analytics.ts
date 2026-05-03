/**
 * Admin analytics queries. Every endpoint accepts:
 *   ?range=24h|7d|30d|90d (default 7d)
 *   ?country=US
 *   ?device=mobile|tablet|desktop
 *   ?path=/some/page
 *   ?referrerHost=google.com
 *   ?utmSource=newsletter
 *   ?hasUser=true|false  (signed-in only / anonymous only)
 *
 * Filters are AND'd together. Empty / missing filters mean "all".
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";

type Range = "24h" | "7d" | "30d" | "90d";

interface Filters {
  range: Range;
  since: Date;
  country: string | null;
  device: string | null;
  path: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  hasUser: boolean | null;
}

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

function bucketUnit(range: Range): "hour" | "day" {
  return range === "24h" ? "hour" : "day";
}

function pickStr(q: Record<string, unknown>, key: string): string | null {
  const v = q[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseFilters(req: FastifyRequest): Filters {
  const q = (req.query as Record<string, unknown>) ?? {};
  const range = parseRange(q.range);
  const hasUserRaw = pickStr(q, "hasUser");
  return {
    range,
    since: rangeStart(range),
    country: pickStr(q, "country"),
    device: pickStr(q, "device"),
    path: pickStr(q, "path"),
    referrerHost: pickStr(q, "referrerHost"),
    utmSource: pickStr(q, "utmSource"),
    hasUser:
      hasUserRaw === "true" ? true : hasUserRaw === "false" ? false : null,
  };
}

/** Compose a Prisma where clause across all filters. */
function whereFromFilters(f: Filters): Prisma.AnalyticsEventWhereInput {
  const w: Prisma.AnalyticsEventWhereInput = {
    createdAt: { gte: f.since },
  };
  if (f.country) w.country = f.country;
  if (f.device) w.device = f.device;
  if (f.path) w.path = f.path;
  if (f.referrerHost) w.referrerHost = f.referrerHost;
  if (f.utmSource) w.utmSource = f.utmSource;
  if (f.hasUser !== null) {
    w.userId = f.hasUser ? { not: null } : null;
  }
  return w;
}

/** Same filters as raw SQL fragment for the $queryRaw paths. */
function sqlFiltersFragment(f: Filters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`"createdAt" >= ${f.since}`];
  if (f.country) parts.push(Prisma.sql`"country" = ${f.country}`);
  if (f.device) parts.push(Prisma.sql`"device" = ${f.device}`);
  if (f.path) parts.push(Prisma.sql`"path" = ${f.path}`);
  if (f.referrerHost)
    parts.push(Prisma.sql`"referrerHost" = ${f.referrerHost}`);
  if (f.utmSource) parts.push(Prisma.sql`"utmSource" = ${f.utmSource}`);
  if (f.hasUser === true) parts.push(Prisma.sql`"userId" IS NOT NULL`);
  if (f.hasUser === false) parts.push(Prisma.sql`"userId" IS NULL`);
  return parts.reduce(
    (acc, p, i) => (i === 0 ? p : Prisma.sql`${acc} AND ${p}`),
    Prisma.sql``,
  );
}

/** Same filters but for a previous-period comparison window. */
function prevWindow(f: Filters): { gte: Date; lt: Date } {
  const span = Date.now() - f.since.getTime();
  return {
    gte: new Date(f.since.getTime() - span),
    lt: f.since,
  };
}

export const adminAnalyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
  });

  // ─── Top-level KPIs ──────────────────────────────────────────────────
  app.get("/summary", async (request) => {
    const f = parseFilters(request);
    const where = whereFromFilters(f);
    const prev = prevWindow(f);
    const prevWhere: Prisma.AnalyticsEventWhereInput = {
      ...where,
      createdAt: prev,
    };

    const [totals, prevTotals, uniqVisitors, uniqSessions, uniqPrev] =
      await Promise.all([
        prisma.analyticsEvent.count({ where }),
        prisma.analyticsEvent.count({ where: prevWhere }),
        prisma.analyticsEvent.findMany({
          where,
          distinct: ["visitorId"],
          select: { visitorId: true },
        }),
        prisma.analyticsEvent.findMany({
          where,
          distinct: ["sessionId"],
          select: { sessionId: true },
        }),
        prisma.analyticsEvent.findMany({
          where: prevWhere,
          distinct: ["visitorId"],
          select: { visitorId: true },
        }),
      ]);

    // Bounce + avg session via raw SQL — needs grouped aggregates.
    const sessionStats = await prisma.$queryRaw<
      Array<{ session_id: string; n: bigint; span: number }>
    >(Prisma.sql`
      SELECT "sessionId" AS session_id,
             COUNT(*)::bigint AS n,
             EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt")))::float AS span
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
      GROUP BY "sessionId"
    `);
    const bounced = sessionStats.filter((s) => Number(s.n) === 1).length;
    const bounceRate =
      sessionStats.length > 0 ? bounced / sessionStats.length : 0;
    const avgSessionSec =
      sessionStats.length > 0
        ? sessionStats.reduce((acc, s) => acc + (Number(s.span) || 0), 0) /
          sessionStats.length
        : 0;

    return {
      range: f.range,
      since: f.since.toISOString(),
      pageviews: totals,
      pageviewsPrev: prevTotals,
      uniqueVisitors: uniqVisitors.length,
      uniqueVisitorsPrev: uniqPrev.length,
      sessions: uniqSessions.length,
      bounceRate,
      avgSessionSec: Math.round(avgSessionSec),
    };
  });

  // ─── Time-series ─────────────────────────────────────────────────────
  app.get("/timeseries", async (request) => {
    const f = parseFilters(request);
    const unit = bucketUnit(f.range);
    const rows = await prisma.$queryRaw<
      Array<{ bucket: Date; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT date_trunc(${unit}, "createdAt") AS bucket,
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return {
      range: f.range,
      unit,
      points: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        pageviews: Number(r.pageviews),
        visitors: Number(r.visitors),
      })),
    };
  });

  // ─── Top tables ──────────────────────────────────────────────────────
  app.get("/top-pages", async (request) => {
    const f = parseFilters(request);
    const rows = await prisma.$queryRaw<
      Array<{ path: string; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT "path",
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
      GROUP BY "path"
      ORDER BY pageviews DESC
      LIMIT 25
    `);
    return rows.map((r) => ({
      path: r.path,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  app.get("/top-sources", async (request) => {
    const f = parseFilters(request);
    const rows = await prisma.$queryRaw<
      Array<{ source: string; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF("utmSource", ''), "referrerHost", '(direct)') AS source,
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
      GROUP BY source
      ORDER BY pageviews DESC
      LIMIT 25
    `);
    return rows.map((r) => ({
      source: r.source,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  app.get("/top-referrers", async (request) => {
    const f = parseFilters(request);
    const rows = await prisma.$queryRaw<
      Array<{ host: string; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT "referrerHost" AS host,
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
        AND "referrerHost" IS NOT NULL
      GROUP BY host
      ORDER BY pageviews DESC
      LIMIT 25
    `);
    return rows.map((r) => ({
      host: r.host,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  app.get("/top-countries", async (request) => {
    const f = parseFilters(request);
    const rows = await prisma.$queryRaw<
      Array<{ country: string; pageviews: bigint; visitors: bigint }>
    >(Prisma.sql`
      SELECT COALESCE(NULLIF("country", ''), '(unknown)') AS country,
             COUNT(*)::bigint AS pageviews,
             COUNT(DISTINCT "visitorId")::bigint AS visitors
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
      GROUP BY country
      ORDER BY pageviews DESC
      LIMIT 25
    `);
    return rows.map((r) => ({
      country: r.country,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
    }));
  });

  app.get("/devices", async (request) => {
    const f = parseFilters(request);
    const [devices, browsers, oses] = await Promise.all([
      prisma.$queryRaw<Array<{ key: string; n: bigint }>>(Prisma.sql`
        SELECT COALESCE(NULLIF("device", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
        FROM analytics_event WHERE ${sqlFiltersFragment(f)}
        GROUP BY key ORDER BY n DESC LIMIT 10
      `),
      prisma.$queryRaw<Array<{ key: string; n: bigint }>>(Prisma.sql`
        SELECT COALESCE(NULLIF("browser", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
        FROM analytics_event WHERE ${sqlFiltersFragment(f)}
        GROUP BY key ORDER BY n DESC LIMIT 10
      `),
      prisma.$queryRaw<Array<{ key: string; n: bigint }>>(Prisma.sql`
        SELECT COALESCE(NULLIF("os", ''), '(unknown)') AS key, COUNT(*)::bigint AS n
        FROM analytics_event WHERE ${sqlFiltersFragment(f)}
        GROUP BY key ORDER BY n DESC LIMIT 10
      `),
    ]);
    return {
      devices: devices.map((r) => ({ key: r.key, n: Number(r.n) })),
      browsers: browsers.map((r) => ({ key: r.key, n: Number(r.n) })),
      oses: oses.map((r) => ({ key: r.key, n: Number(r.n) })),
    };
  });

  // ─── Live activity feed ──────────────────────────────────────────────
  app.get("/recent", async (request) => {
    const f = parseFilters(request);
    const rows = await prisma.analyticsEvent.findMany({
      where: whereFromFilters(f),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        visitorId: true,
        path: true,
        country: true,
        city: true,
        region: true,
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

  // ─── Realtime (last 5 minutes) ───────────────────────────────────────
  app.get("/realtime", async () => {
    const since = new Date(Date.now() - 5 * 60_000);
    const [active, paths] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: since } },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }),
      prisma.$queryRaw<
        Array<{ path: string; visitors: bigint }>
      >(Prisma.sql`
        SELECT "path", COUNT(DISTINCT "visitorId")::bigint AS visitors
        FROM analytics_event
        WHERE "createdAt" >= ${since}
        GROUP BY "path"
        ORDER BY visitors DESC
        LIMIT 10
      `),
    ]);
    return {
      activeVisitors: active.length,
      since: since.toISOString(),
      paths: paths.map((p) => ({
        path: p.path,
        visitors: Number(p.visitors),
      })),
    };
  });

  // ─── Visitors list ───────────────────────────────────────────────────
  app.get("/visitors", async (request) => {
    const f = parseFilters(request);
    const q = (request.query as Record<string, unknown>) ?? {};
    const page = Math.max(1, parseInt(pickStr(q, "page") ?? "1", 10) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;

    const totalRow = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "visitorId")::bigint AS n
      FROM analytics_event
      WHERE ${sqlFiltersFragment(f)}
    `);
    const total = Number(totalRow[0]?.n ?? 0);

    const rows = await prisma.$queryRaw<
      Array<{
        visitorId: string;
        firstSeen: Date;
        lastSeen: Date;
        sessionCount: bigint;
        pageviewCount: bigint;
        country: string | null;
        region: string | null;
        city: string | null;
        device: string | null;
        browser: string | null;
        os: string | null;
        userId: string | null;
        userName: string | null;
        userEmail: string | null;
        firstReferrerHost: string | null;
        firstUtmSource: string | null;
      }>
    >(Prisma.sql`
      WITH agg AS (
        SELECT "visitorId",
               MIN("createdAt") AS "firstSeen",
               MAX("createdAt") AS "lastSeen",
               COUNT(DISTINCT "sessionId")::bigint AS "sessionCount",
               COUNT(*)::bigint AS "pageviewCount"
        FROM analytics_event
        WHERE ${sqlFiltersFragment(f)}
        GROUP BY "visitorId"
      )
      SELECT a."visitorId",
             a."firstSeen",
             a."lastSeen",
             a."sessionCount",
             a."pageviewCount",
             latest."country",
             latest."region",
             latest."city",
             latest."device",
             latest."browser",
             latest."os",
             latest."userId",
             u."name" AS "userName",
             u."email" AS "userEmail",
             first."referrerHost" AS "firstReferrerHost",
             first."utmSource" AS "firstUtmSource"
        FROM agg a
        LEFT JOIN LATERAL (
          SELECT "country","region","city","device","browser","os","userId"
          FROM analytics_event ae
          WHERE ae."visitorId" = a."visitorId"
            AND ae."createdAt" >= ${f.since}
          ORDER BY ae."createdAt" DESC
          LIMIT 1
        ) latest ON TRUE
        LEFT JOIN LATERAL (
          SELECT "referrerHost","utmSource"
          FROM analytics_event ae
          WHERE ae."visitorId" = a."visitorId"
            AND ae."createdAt" >= ${f.since}
          ORDER BY ae."createdAt" ASC
          LIMIT 1
        ) first ON TRUE
        LEFT JOIN "user" u ON u."id" = latest."userId"
       ORDER BY a."lastSeen" DESC
       LIMIT ${limit} OFFSET ${offset}
    `);

    return {
      total,
      page,
      limit,
      visitors: rows.map((r) => ({
        visitorId: r.visitorId,
        firstSeen: r.firstSeen.toISOString(),
        lastSeen: r.lastSeen.toISOString(),
        sessionCount: Number(r.sessionCount),
        pageviewCount: Number(r.pageviewCount),
        country: r.country,
        region: r.region,
        city: r.city,
        device: r.device,
        browser: r.browser,
        os: r.os,
        firstReferrerHost: r.firstReferrerHost,
        firstUtmSource: r.firstUtmSource,
        user:
          r.userId && (r.userName || r.userEmail)
            ? {
                id: r.userId,
                name: r.userName,
                email: r.userEmail,
              }
            : null,
      })),
    };
  });

  // ─── Visitor detail (sessions + journeys) ────────────────────────────
  app.get("/visitors/:visitorId", async (request, reply) => {
    const { visitorId } = request.params as { visitorId: string };
    if (!visitorId) {
      return reply.status(400).send({ error: "Missing visitorId" });
    }

    // No date floor here — we want full history of the visitor.
    const events = await prisma.analyticsEvent.findMany({
      where: { visitorId },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: {
        id: true,
        sessionId: true,
        path: true,
        pathFull: true,
        title: true,
        referrer: true,
        referrerHost: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        country: true,
        region: true,
        city: true,
        device: true,
        browser: true,
        browserVersion: true,
        os: true,
        durationMs: true,
        userId: true,
        user: { select: { id: true, name: true, email: true } },
        createdAt: true,
      },
    });

    if (events.length === 0) {
      return reply.status(404).send({ error: "Visitor not found" });
    }

    // Summary (computed from full history).
    const first = events[0]!;
    const last = events[events.length - 1]!;
    const sessionIds = new Set(events.map((e) => e.sessionId));
    const visitorUser = events.find((e) => e.user)?.user ?? null;

    // Group into sessions, ordered chronologically.
    const sessionsMap = new Map<string, typeof events>();
    for (const ev of events) {
      const arr = sessionsMap.get(ev.sessionId) ?? [];
      arr.push(ev);
      sessionsMap.set(ev.sessionId, arr);
    }
    const sessions = Array.from(sessionsMap.entries())
      .map(([sessionId, evs]) => {
        const sFirst = evs[0]!;
        const sLast = evs[evs.length - 1]!;
        const durationSec = Math.max(
          0,
          Math.round(
            (sLast.createdAt.getTime() - sFirst.createdAt.getTime()) / 1000,
          ),
        );
        return {
          sessionId,
          startedAt: sFirst.createdAt.toISOString(),
          endedAt: sLast.createdAt.toISOString(),
          durationSec,
          pageviewCount: evs.length,
          entryPath: sFirst.path,
          exitPath: sLast.path,
          entryReferrer: sFirst.referrer,
          entryReferrerHost: sFirst.referrerHost,
          entryUtmSource: sFirst.utmSource,
          entryUtmMedium: sFirst.utmMedium,
          entryUtmCampaign: sFirst.utmCampaign,
          country: sFirst.country,
          region: sFirst.region,
          city: sFirst.city,
          device: sFirst.device,
          browser: sFirst.browser,
          browserVersion: sFirst.browserVersion,
          os: sFirst.os,
          events: evs.map((ev, i) => {
            const next = evs[i + 1];
            const timeOnPageMs = next
              ? next.createdAt.getTime() - ev.createdAt.getTime()
              : null;
            return {
              id: ev.id,
              path: ev.path,
              pathFull: ev.pathFull,
              title: ev.title,
              createdAt: ev.createdAt.toISOString(),
              timeOnPageMs,
            };
          }),
        };
      })
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));

    return {
      visitor: {
        visitorId,
        firstSeen: first.createdAt.toISOString(),
        lastSeen: last.createdAt.toISOString(),
        sessionCount: sessionIds.size,
        pageviewCount: events.length,
        country: last.country,
        region: last.region,
        city: last.city,
        device: last.device,
        browser: last.browser,
        browserVersion: last.browserVersion,
        os: last.os,
        user: visitorUser,
      },
      sessions,
    };
  });
};
