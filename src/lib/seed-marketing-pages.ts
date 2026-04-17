import { prisma } from "./prisma.js";
import {
  defaultConnectPageSchema,
  defaultHomePageSchema,
  type PageSchema,
} from "./page-schema.js";

/**
 * Ensure the editable `home` + `connect` pages exist and each have at least
 * one published version. Non-destructive: leaves existing content untouched
 * if the page already has any version.
 */
export async function seedMarketingPages(): Promise<{
  created: number;
  already: number;
}> {
  const stats = { created: 0, already: 0 };

  async function ensure(
    slug: string,
    name: string,
    description: string,
    buildSchema: () => PageSchema | Promise<PageSchema>,
  ) {
    const existing = await prisma.marketingPage.findUnique({
      where: { slug },
      include: { versions: true },
    });
    if (existing && existing.versions.length > 0) {
      stats.already += 1;
      return;
    }
    const page =
      existing ??
      (await prisma.marketingPage.create({
        data: { slug, name, description },
      }));
    await prisma.marketingPageVersion.create({
      data: {
        pageId: page.id,
        version: 1,
        label: "v1 (seeded)",
        schema: (await buildSchema()) as object,
        published: true,
      },
    });
    stats.created += 1;
  }

  await ensure("home", "Homepage", "The front page of momentella.com", () =>
    defaultHomePageSchema(),
  );

  await ensure(
    "connect",
    "Connect (intake form)",
    "The /connect page that hosts the trip intake form",
    async () => {
      // Prefer a currently-published intake form; fall back to "family-trip".
      const form = await prisma.intakeForm.findFirst({
        where: {
          archived: false,
          versions: { some: { published: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return defaultConnectPageSchema(form?.slug ?? "family-trip");
    },
  );

  return stats;
}
