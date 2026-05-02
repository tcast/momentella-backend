/**
 * Analytics helpers — geo / UA parsing / IP hashing.
 *
 * Privacy: we never store raw IPs. The hash uses a daily-rotating salt
 * so we can compute unique-visitor counts within a day without ever
 * being able to invert back to the originating address.
 */

import crypto from "node:crypto";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import type { FastifyRequest } from "fastify";

const KNOWN_BOTS = [
  "googlebot",
  "bingbot",
  "duckduckbot",
  "yandexbot",
  "baiduspider",
  "slurp",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "applebot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "petalbot",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "curl/",
  "wget/",
  "python-requests",
  "node-fetch",
  "axios/",
];

export interface ParsedUa {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  /** "mobile" | "tablet" | "desktop" | "bot" */
  device: string;
}

export function parseUserAgent(ua: string | undefined | null): ParsedUa {
  const safe = (ua ?? "").toLowerCase();
  if (!safe) {
    return { browser: null, browserVersion: null, os: null, device: "bot" };
  }
  if (KNOWN_BOTS.some((b) => safe.includes(b))) {
    return { browser: null, browserVersion: null, os: null, device: "bot" };
  }
  const r = new UAParser(ua ?? undefined).getResult();
  const dt = (r.device.type ?? "").toLowerCase();
  const device =
    dt === "mobile" ? "mobile" : dt === "tablet" ? "tablet" : "desktop";
  return {
    browser: r.browser.name ?? null,
    browserVersion: r.browser.version ?? null,
    os: r.os.name ?? null,
    device,
  };
}

/**
 * Returns the request's originating IP address, preferring CF-Connecting-IP
 * (Cloudflare), then standard forwarded headers. Empty string if nothing
 * trustworthy is available.
 */
export function getClientIp(req: FastifyRequest): string {
  const h = req.headers;
  const cf = h["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.trim();
  const xfwd = h["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd) {
    return xfwd.split(",")[0]?.trim() ?? "";
  }
  const real = h["x-real-ip"];
  if (typeof real === "string" && real) return real.trim();
  return req.ip ?? "";
}

/** Read a header that may be string or string[] as a single string. */
function pickHeader(v: string | string[] | undefined): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0]?.trim() || null;
  return v.trim() || null;
}

export interface ResolvedGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/**
 * Strip private / loopback / link-local addresses we won't be able to
 * resolve. Returns null for unusable inputs.
 */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "127.0.0.1") return false;
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.") ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fc00:") ||
    ip.startsWith("fd00:")
  )
    return false;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return false;
  }
  return true;
}

/**
 * Resolve country / region / city for a request. Uses Cloudflare-style
 * headers first when available (faster, more authoritative than the
 * bundled DB), then falls back to a local geoip-lite lookup against the
 * client IP. Returns nulls only for private / unknown addresses.
 */
export function resolveGeo(req: FastifyRequest, ip: string): ResolvedGeo {
  const h = req.headers;
  const cfCountry = pickHeader(h["cf-ipcountry"]);
  const cfRegion = pickHeader(h["cf-region"]);
  const cfCity = pickHeader(h["cf-ipcity"]);

  // Even when Cloudflare proxy isn't enabled, occasionally cf-ipcountry
  // may show "XX" for unknown — treat that as missing.
  const cfHasCountry = cfCountry && cfCountry !== "XX";

  // Local DB lookup — only if we have a useful public IP.
  let dbHit: geoip.Lookup | null = null;
  if (isPublicIp(ip)) {
    try {
      dbHit = geoip.lookup(ip);
    } catch {
      dbHit = null;
    }
  }

  return {
    country: cfHasCountry ? cfCountry : (dbHit?.country ?? null),
    region: cfRegion ?? (dbHit?.region ?? null),
    city: cfCity ?? (dbHit?.city ?? null),
  };
}

function dailySalt(): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const secret =
    process.env.ANALYTICS_IP_SALT?.trim() ||
    process.env.BETTER_AUTH_SECRET ||
    "momentella-analytics";
  return `${day}:${secret}`;
}

/** SHA-256 of the IP plus today's salt — non-invertible, rotates daily. */
export function hashIp(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(`${dailySalt()}|${ip}`)
    .digest("hex");
}

/**
 * Extract a hostname from a referrer URL. Self-referrers (same site as
 * the page being viewed) are folded into "(direct)" so the source
 * attribution doesn't show e.g. "momentella.com" when really the user
 * just navigated within the site.
 */
export function classifyReferrer(
  referrer: string | undefined | null,
  selfHost: string | undefined | null,
): { referrer: string | null; referrerHost: string | null } {
  if (!referrer || typeof referrer !== "string") {
    return { referrer: null, referrerHost: null };
  }
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    if (selfHost && host === selfHost.toLowerCase()) {
      return { referrer: null, referrerHost: null };
    }
    return { referrer, referrerHost: host };
  } catch {
    return { referrer, referrerHost: null };
  }
}
