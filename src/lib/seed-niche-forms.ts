import { prisma } from "./prisma.js";
import { NICHE_FORMS } from "./niche-form-schemas.js";

/**
 * Idempotent: ensure each niche-specific intake form exists with at
 * least one published version. Non-destructive — admin edits to any
 * existing version are preserved.
 */
export async function seedNicheForms(): Promise<{
  created: number;
  already: number;
}> {
  const stats = { created: 0, already: 0 };

  for (const def of NICHE_FORMS) {
    const existing = await prisma.intakeForm.findUnique({
      where: { slug: def.slug },
      include: { versions: true },
    });
    if (existing && existing.versions.length > 0) {
      stats.already += 1;
      continue;
    }
    const form =
      existing ??
      (await prisma.intakeForm.create({
        data: {
          slug: def.slug,
          name: def.name,
          description: def.description,
        },
      }));
    await prisma.intakeFormVersion.create({
      data: {
        formId: form.id,
        version: 1,
        label: "v1 (seeded)",
        schema: def.schema() as object,
        published: true,
      },
    });
    stats.created += 1;
  }

  return stats;
}
