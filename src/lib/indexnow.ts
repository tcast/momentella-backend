/**
 * IndexNow client — https://www.indexnow.org. A simple HTTP POST that
 * tells participating search engines (Bing, Yandex, Naver, Seznam,
 * DuckDuckGo's index sources) to recrawl specific URLs *now* rather
 * than waiting their normal cadence.
 *
 * Bing's index powers Copilot AND ChatGPT's web search, so fast
 * IndexNow pings = fast LLM citation pickup for new content. This is
 * the single highest-leverage GEO move in 2026.
 *
 * Submissions are best-effort — failures never block content publishes.
 * Every call is logged to the `indexnow_log` table so the SEO admin
 * dashboard can show recent submission history.
 */

import { prisma } from "./prisma.js";
import {
  getOrCreateIndexNowKey,
  SETTING_KEYS,
  setSetting,
} from "./site-settings.js";

function siteOrigin(): string {
  return (
    process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://momentella.com"
  );
}

/**
 * Where the IndexNow key file is publicly served. Bing's implementation
 * rejects custom `keyLocation` values reliably; we host at the
 * spec-default location `/{KEY}.txt` and omit `keyLocation` from the
 * submission so IndexNow uses its default behaviour.
 */
function keyLocation(key: string): string {
  return `${siteOrigin()}/${key}.txt`;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  urls: string[];
  message?: string;
}

/**
 * Submit one or more URLs to api.indexnow.org. Pass full URLs (with
 * https://...). Empty / non-https URLs are filtered. Errors are caught
 * and surfaced in the result; never thrown.
 */
export async function submitIndexNow(
  urls: string[],
  trigger: "auto" | "manual" = "auto",
): Promise<SubmitResult> {
  const valid = Array.from(
    new Set(
      urls.filter(
        (u) => typeof u === "string" && /^https:\/\//i.test(u.trim()),
      ),
    ),
  );
  if (valid.length === 0) {
    return { ok: false, status: 0, urls: [], message: "no valid URLs" };
  }
  const key = await getOrCreateIndexNowKey();
  const host = new URL(siteOrigin()).host;
  const body = {
    host,
    key,
    keyLocation: keyLocation(key),
    urlList: valid,
  };
  let status = 0;
  let message: string | undefined;
  try {
    const controller = new AbortController();
    const tm = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tm);
    status = res.status;
    // 200 = accepted, 202 = received-pending, both are success.
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      message = text.slice(0, 400) || `HTTP ${res.status}`;
    }
  } catch (err) {
    message = err instanceof Error ? err.message : "network error";
  }
  const ok = status === 200 || status === 202;
  // Log every submission so the admin dashboard can show it.
  try {
    await prisma.indexNowLog.create({
      data: {
        urls: valid,
        status,
        trigger,
        message: ok ? null : message ?? null,
      },
    });
    if (ok) {
      await setSetting(SETTING_KEYS.lastIndexNowAt, new Date().toISOString());
    }
    // Trim to most recent 100 entries.
    const overflow = await prisma.indexNowLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: 100,
      take: 1000,
      select: { id: true },
    });
    if (overflow.length > 0) {
      await prisma.indexNowLog.deleteMany({
        where: { id: { in: overflow.map((o) => o.id) } },
      });
    }
  } catch {
    // logging is best-effort
  }
  return { ok, status, urls: valid, message };
}

/**
 * Fire-and-forget IndexNow submission. Used in content publish hooks
 * where we don't want a slow IndexNow call to block the response.
 */
export function submitIndexNowAsync(
  urls: string[],
  trigger: "auto" | "manual" = "auto",
): void {
  // Intentionally not awaited; errors are swallowed inside submitIndexNow.
  void submitIndexNow(urls, trigger);
}
