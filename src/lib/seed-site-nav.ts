import { prisma } from "./prisma.js";
import { defaultSiteNavConfig } from "./site-nav-schema.js";

/**
 * Ensure the singleton SiteNavConfig row exists. Non-destructive — if a
 * row is already present, it's left alone (admin edits win).
 */
export async function seedSiteNav(): Promise<{ created: boolean }> {
  const existing = await prisma.siteNavConfig.findUnique({
    where: { id: "default" },
  });
  if (existing) return { created: false };
  await prisma.siteNavConfig.create({
    data: { id: "default", config: defaultSiteNavConfig() as object },
  });
  return { created: true };
}
