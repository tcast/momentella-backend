import { prisma } from "./prisma.js";
import {
  defaultConnectPageSchema,
  defaultGiftCertificatesPageSchema,
  defaultHomePageSchema,
  defaultTripBookingPageSchema,
  type PageSchema,
} from "./page-schema.js";
import { NICHE_PAGES, nichePageSchema } from "./niche-pages.js";

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

  await ensure(
    "trip-booking",
    "Trip booking (full-service pitch)",
    "The /trip-booking marketing page — pitches end-to-end planning and embeds the intake form",
    async () => {
      const form = await prisma.intakeForm.findFirst({
        where: {
          archived: false,
          versions: { some: { published: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return defaultTripBookingPageSchema(form?.slug ?? "family-trip");
    },
  );

  await ensure(
    "gift-certificates",
    "Gift certificates",
    "The /gift-certificates marketing page — promotes itinerary planning as a gift (Mother's Day-aware copy by default)",
    () => defaultGiftCertificatesPageSchema(),
  );

  // Niche / SEO landing pages — one per travel sub-segment we serve.
  // Each is editable via the page builder; we just seed initial copy.
  for (const niche of NICHE_PAGES) {
    await ensure(
      niche.slug,
      niche.name,
      niche.description,
      () => nichePageSchema(niche),
    );
  }

  return stats;
}
