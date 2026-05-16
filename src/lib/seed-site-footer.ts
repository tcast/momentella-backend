import { prisma } from "./prisma.js";
import { defaultSiteFooterConfig } from "./site-footer-schema.js";

/**
 * Ensure the singleton SiteFooterConfig row exists. Non-destructive —
 * if a row is already present, it's left alone (admin edits win).
 */
export async function seedSiteFooter(): Promise<{ created: boolean }> {
  const existing = await prisma.siteFooterConfig.findUnique({
    where: { id: "default" },
  });
  if (existing) return { created: false };
  await prisma.siteFooterConfig.create({
    data: { id: "default", config: defaultSiteFooterConfig() as object },
  });
  return { created: true };
}
