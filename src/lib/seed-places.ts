import { prisma } from "./prisma.js";
import { AIRPORT_SEED } from "./airports-seed.js";
import { DESTINATION_SEED } from "./destinations-seed.js";

/**
 * Idempotent seeder. Upserts airports + destinations by unique key.
 * Safe to call on every boot — only inserts missing rows and fixes renamed ones.
 * Admin-edited rows are preserved because upsert only sets listed fields; the
 * `active` flag is only set on CREATE so admins can deactivate rows that we seed.
 */
export async function seedPlaces(): Promise<{
  airports: { created: number; updated: number };
  destinations: { created: number; updated: number };
}> {
  const stats = {
    airports: { created: 0, updated: 0 },
    destinations: { created: 0, updated: 0 },
  };

  for (const a of AIRPORT_SEED) {
    const existing = await prisma.airport.findUnique({ where: { iata: a.iata } });
    if (!existing) {
      await prisma.airport.create({
        data: {
          iata: a.iata,
          icao: a.icao ?? null,
          name: a.name,
          city: a.city,
          region: a.region ?? null,
          country: a.country,
          countryCode: a.countryCode,
          active: true,
        },
      });
      stats.airports.created += 1;
    } else {
      await prisma.airport.update({
        where: { iata: a.iata },
        data: {
          icao: a.icao ?? existing.icao,
          name: a.name,
          city: a.city,
          region: a.region ?? existing.region,
          country: a.country,
          countryCode: a.countryCode,
        },
      });
      stats.airports.updated += 1;
    }
  }

  for (const d of DESTINATION_SEED) {
    const existing = await prisma.destination.findUnique({
      where: { slug: d.slug },
    });
    if (!existing) {
      await prisma.destination.create({
        data: {
          slug: d.slug,
          name: d.name,
          type: d.type,
          country: d.country ?? null,
          region: d.region ?? null,
          aliases: d.aliases ?? null,
          active: true,
        },
      });
      stats.destinations.created += 1;
    } else {
      await prisma.destination.update({
        where: { slug: d.slug },
        data: {
          name: d.name,
          type: d.type,
          country: d.country ?? existing.country,
          region: d.region ?? existing.region,
          aliases: d.aliases ?? existing.aliases,
        },
      });
      stats.destinations.updated += 1;
    }
  }

  return stats;
}
