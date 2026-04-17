import type { FormField, IntakeFormSchema } from "./intake-schema.js";

/** Short plaintext lines for email / admin preview. */
export function summarizeIntakeResponses(
  schema: IntakeFormSchema,
  responses: Record<string, unknown>,
  maxLines = 40,
): string[] {
  const lines: string[] = [];
  for (const field of schema.fields) {
    if (field.type === "section") continue;
    const val = responses[field.id];
    if (val === undefined || val === null || val === "") continue;
    const line = formatFieldLine(field, val);
    if (line) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

function formatFieldLine(field: FormField, val: unknown): string | null {
  if (field.type === "travel_party" && val && typeof val === "object") {
    const tp = val as Record<string, unknown>;
    const adults = tp.adults;
    const children = tp.children;
    const ages = tp.childAges;
    let s = `${field.label}: adults ${String(adults)}, children ${String(children)}`;
    if (Array.isArray(ages) && ages.length) {
      s += ` (ages: ${ages.join(", ")})`;
    }
    return s;
  }
  if (field.type === "multiselect" && Array.isArray(val)) {
    const labels = val.map((v) => {
      const opt = field.options.find((o) => o.value === v);
      return opt?.label ?? String(v);
    });
    return `${field.label}: ${labels.join(", ")}`;
  }
  if (field.type === "select") {
    const opt = field.options.find((o) => o.value === val);
    return `${field.label}: ${opt?.label ?? String(val)}`;
  }
  if (typeof val === "object" && val !== null) {
    return `${field.label}: ${JSON.stringify(val)}`;
  }
  return `${field.label}: ${String(val)}`;
}
