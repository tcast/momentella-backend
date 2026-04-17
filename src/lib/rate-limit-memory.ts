/** Simple fixed-window rate limiter for public endpoints (per-process; resets on deploy). */

const buckets = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS = 40;

export function checkIntakeSubmitRateLimit(clientKey: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  let b = buckets.get(clientKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(clientKey, b);
  }
  if (b.count >= MAX_REQUESTS) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

export function clientIpFromRequest(headers: {
  [k: string]: string | string[] | undefined;
}): string {
  const xf = headers["x-forwarded-for"];
  const first =
    typeof xf === "string"
      ? xf.split(",")[0]?.trim()
      : Array.isArray(xf)
        ? xf[0]?.trim()
        : "";
  return first || "unknown";
}
