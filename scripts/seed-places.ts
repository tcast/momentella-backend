/**
 * Stand-alone seed / refresh for airports + destinations.
 * Run:  railway run -s api npx tsx scripts/seed-places.ts
 * Or locally: DATABASE_URL=... npx tsx scripts/seed-places.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { seedPlaces } from "../src/lib/seed-places.js";

async function main() {
  const stats = await seedPlaces();
  console.log(JSON.stringify({ ok: true, ...stats }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
