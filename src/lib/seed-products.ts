/**
 * Seed the catalog with the three default itinerary planning packages on
 * first boot. Idempotent — re-running won't duplicate.
 */

import { prisma } from "./prisma.js";

interface Seed {
  slug: string;
  name: string;
  description: string;
  itineraryDays: number;
  priceCents: number;
  sortOrder: number;
}

const DEFAULTS: Seed[] = [
  {
    slug: "itinerary-1-day",
    name: "1-day itinerary",
    description:
      "We design one perfectly-paced day for your family — handpicked stops, restaurant reservations where it matters, and the small logistics that make a great day feel effortless.",
    itineraryDays: 1,
    priceCents: 14900,
    sortOrder: 10,
  },
  {
    slug: "itinerary-2-day",
    name: "2-day itinerary",
    description:
      "Two days, designed in concert. Lodging guidance, transit, daily flow, dining, kid-friendly anchors — everything you need to land and just go.",
    itineraryDays: 2,
    priceCents: 24900,
    sortOrder: 20,
  },
  {
    slug: "itinerary-3-day",
    name: "3-day itinerary",
    description:
      "A complete three-day plan: morning to dinner, every day. Built around your travelers, your pace, and the moments you'll remember.",
    itineraryDays: 3,
    priceCents: 34900,
    sortOrder: 30,
  },
];

export async function seedProducts(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const s of DEFAULTS) {
    const found = await prisma.product.findUnique({ where: { slug: s.slug } });
    if (found) {
      existing += 1;
      continue;
    }
    await prisma.product.create({
      data: {
        slug: s.slug,
        kind: "ITINERARY_PLANNING",
        name: s.name,
        description: s.description,
        itineraryDays: s.itineraryDays,
        priceCents: s.priceCents,
        sortOrder: s.sortOrder,
        active: true,
      },
    });
    created += 1;
  }
  return { created, existing };
}
