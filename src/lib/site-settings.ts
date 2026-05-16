/**
 * Thin helpers over the `SiteSetting` key/value table. Used for
 * verification meta tags, the IndexNow key, and miscellaneous timestamps
 * (last submission, etc.) that the SEO admin dashboard needs to surface.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

/** Every key the app reads. The frontend uses the same names. */
export const SETTING_KEYS = {
  verifyGoogle: "verify_google",
  verifyBing: "verify_bing",
  verifyYandex: "verify_yandex",
  verifyPinterest: "verify_pinterest",
  verifyMeta: "verify_meta",
  indexNowKey: "indexnow_key",
  lastIndexNowAt: "last_indexnow_at",
} as const;

export type KnownSettingKey =
  (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Read a single setting, returning null if it's missing or empty. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  const v = row?.value?.trim();
  return v && v.length > 0 ? v : null;
}

/** Read every setting as a flat map (only present keys). */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.siteSetting.findMany();
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.value?.trim()) out[r.key] = r.value.trim();
  }
  return out;
}

/**
 * Upsert one setting. If value is empty, the row is removed entirely so
 * `getSetting` returns null cleanly. Returns the new effective value.
 */
export async function setSetting(
  key: string,
  value: string | null,
): Promise<string | null> {
  const v = value?.trim() ?? "";
  if (!v) {
    await prisma.siteSetting.deleteMany({ where: { key } });
    return null;
  }
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: v },
    update: { value: v },
  });
  return v;
}

/**
 * Returns the IndexNow key, generating a fresh one the first time it's
 * requested. IndexNow only requires that the same key keep working —
 * we never rotate it automatically. Hex string, 32 chars.
 */
export async function getOrCreateIndexNowKey(): Promise<string> {
  const existing = await getSetting(SETTING_KEYS.indexNowKey);
  if (existing) return existing;
  const fresh = randomBytes(16).toString("hex");
  await setSetting(SETTING_KEYS.indexNowKey, fresh);
  return fresh;
}
