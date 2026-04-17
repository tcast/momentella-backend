/**
 * Stand-alone seeder for marketing pages (ensures `home` exists with a
 * published v1 mirroring the current hardcoded homepage).
 * Run: railway run -s api npx tsx scripts/seed-pages.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { seedMarketingPages } from "../src/lib/seed-marketing-pages.js";

async function main() {
  const stats = await seedMarketingPages();
  console.log(JSON.stringify({ ok: true, ...stats }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
