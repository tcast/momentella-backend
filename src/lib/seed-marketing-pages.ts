import { prisma } from "./prisma.js";
import { defaultHomePageSchema } from "./page-schema.js";

/**
 * Ensure the editable `home` page exists and has at least one published
 * version. Non-destructive: leaves existing content untouched if the page
 * already has any version.
 */
export async function seedMarketingPages(): Promise<{
  created: number;
  already: number;
}> {
  const stats = { created: 0, already: 0 };
  const slug = "home";
  const existing = await prisma.marketingPage.findUnique({
    where: { slug },
    include: { versions: true },
  });
  if (existing && existing.versions.length > 0) {
    stats.already += 1;
    return stats;
  }
  const page =
    existing ??
    (await prisma.marketingPage.create({
      data: {
        slug,
        name: "Homepage",
        description: "The front page of momentella.com",
      },
    }));
  await prisma.marketingPageVersion.create({
    data: {
      pageId: page.id,
      version: 1,
      label: "v1 (imported from site)",
      schema: defaultHomePageSchema() as object,
      published: true,
    },
  });
  stats.created += 1;
  return stats;
}
