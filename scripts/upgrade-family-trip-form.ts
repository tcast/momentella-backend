/**
 * One-off upgrade: for every version of the `family-trip` intake form, replace
 * the legacy `destinations` multiselect with the new searchable
 * `destination` picker and add a `home_airport` airport picker right after it
 * (if it does not already exist).
 *
 * Idempotent — rerunning does nothing once the shape matches.
 * Run:
 *   railway run -s api npx tsx scripts/upgrade-family-trip-form.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { parseIntakeFormSchema } from "../src/lib/intake-schema.js";
import type { FormField } from "../src/lib/intake-schema.js";

type Patch = {
  versionId: string;
  version: number;
  before: string;
  after: string;
};

async function main() {
  const form = await prisma.intakeForm.findUnique({
    where: { slug: "family-trip" },
    include: { versions: { orderBy: { version: "asc" } } },
  });
  if (!form) {
    console.log(JSON.stringify({ ok: true, note: "no family-trip form" }));
    return;
  }

  const patches: Patch[] = [];
  for (const v of form.versions) {
    const parsed = parseIntakeFormSchema(v.schema);
    if (!parsed) continue;

    let changed = false;
    const out: FormField[] = [];
    const hasHomeAirport = parsed.fields.some((f) => f.id === "home_airport");

    for (const f of parsed.fields) {
      if (f.id === "destinations" && f.type === "multiselect") {
        out.push({
          id: "destinations",
          type: "destination",
          label: f.label ?? "Destinations or regions of interest",
          description:
            "Start typing a country, city, park, or region — add as many as you like.",
          allowMultiple: true,
          required: f.required,
        });
        changed = true;
        if (!hasHomeAirport) {
          out.push({
            id: "home_airport",
            type: "airport",
            label: "Home airport",
            description:
              "Type a city, airport name, or 3-letter code (e.g. DTW).",
          });
        }
      } else {
        out.push(f);
      }
    }

    if (changed) {
      const before = JSON.stringify(parsed.fields.map((f) => `${f.type}:${f.id}`));
      const nextSchema = { version: parsed.version, fields: out };
      await prisma.intakeFormVersion.update({
        where: { id: v.id },
        data: { schema: nextSchema as object },
      });
      patches.push({
        versionId: v.id,
        version: v.version,
        before,
        after: JSON.stringify(out.map((f) => `${f.type}:${f.id}`)),
      });
    }
  }

  console.log(
    JSON.stringify({ ok: true, patchedVersions: patches.length, patches }, null, 2),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
