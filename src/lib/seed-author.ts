/**
 * Idempotent seed of the default Author (Adrienne) so the journal
 * editor has at least one byline available on boot.
 */

import { prisma } from "./prisma.js";

export async function seedDefaultAuthor(): Promise<{ created: boolean }> {
  const existing = await prisma.author.findUnique({
    where: { slug: "adrienne-becker" },
  });
  if (existing) return { created: false };
  await prisma.author.create({
    data: {
      slug: "adrienne-becker",
      name: "Adrienne Becker",
      role: "Founder & lead trip designer",
      bio:
        "Adrienne founded Momentella to plan the kind of trips she wished someone had planned for her — calm, specific, fully managed. She designs every itinerary herself.",
      email: "hello@booking.momentella.com",
      active: true,
    },
  });
  return { created: true };
}
