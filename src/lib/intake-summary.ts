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

export interface ListPreview {
  name: string | null;
  phone: string | null;
  travelers: string | null;
  destinations: string | null;
  homeAirport: string | null;
}

/**
 * Pulls the most interesting answers for the submissions list row so admins
 * see at-a-glance context without opening each one. Robust to renamed field
 * ids — picks by field type + id heuristics.
 */
export function buildListPreview(
  schema: IntakeFormSchema | null,
  responses: Record<string, unknown>,
): ListPreview {
  const p: ListPreview = {
    name: null,
    phone: null,
    travelers: null,
    destinations: null,
    homeAirport: null,
  };
  if (!schema) return p;

  for (const field of schema.fields) {
    if (field.type === "section") continue;
    const val = responses[field.id];
    if (val === undefined || val === null || val === "") continue;

    if (!p.name && field.type === "text" && /name/i.test(field.id + field.label)) {
      if (typeof val === "string") p.name = val;
    }
    if (!p.phone && field.type === "tel") {
      if (typeof val === "string") p.phone = val;
    }
    if (!p.travelers && field.type === "travel_party") {
      if (val && typeof val === "object") {
        const o = val as Record<string, unknown>;
        const adults = typeof o.adults === "number" ? o.adults : Number(o.adults) || 0;
        const children = typeof o.children === "number" ? o.children : Number(o.children) || 0;
        const ages = Array.isArray(o.childAges) ? o.childAges : [];
        const parts = [
          `${adults} adult${adults === 1 ? "" : "s"}`,
          `${children} child${children === 1 ? "" : "ren"}`,
        ];
        let s = parts.join(" · ");
        if (ages.length) s += ` · ages ${ages.join(", ")}`;
        p.travelers = s;
      }
    }
    if (!p.destinations && field.type === "destination") {
      const fmt = (v: unknown) => {
        if (!v || typeof v !== "object") return "";
        const o = v as Record<string, unknown>;
        return typeof o.name === "string" ? o.name : "";
      };
      const names = Array.isArray(val)
        ? val.map(fmt).filter(Boolean)
        : [fmt(val)].filter(Boolean);
      if (names.length) p.destinations = names.join(", ");
    }
    if (!p.homeAirport && field.type === "airport") {
      if (val && typeof val === "object") {
        const o = val as Record<string, unknown>;
        const iata = typeof o.iata === "string" ? o.iata : "";
        const city = typeof o.city === "string" ? o.city : "";
        p.homeAirport = iata && city ? `${iata} · ${city}` : iata || city || null;
      }
    }
  }
  return p;
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
  if (field.type === "airport" && val && typeof val === "object") {
    const a = val as Record<string, unknown>;
    const iata = typeof a.iata === "string" ? a.iata : "";
    const name = typeof a.name === "string" ? a.name : "";
    const city = typeof a.city === "string" ? a.city : "";
    return `${field.label}: ${iata ? iata + " — " : ""}${name}${city ? ` (${city})` : ""}`;
  }
  if (field.type === "destination") {
    const fmt = (v: unknown): string => {
      if (!v || typeof v !== "object") return String(v);
      const o = v as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name : "";
      const country = typeof o.country === "string" ? o.country : "";
      return country && !name.includes(country) ? `${name} (${country})` : name;
    };
    if (field.allowMultiple && Array.isArray(val)) {
      return `${field.label}: ${val.map(fmt).filter(Boolean).join(", ")}`;
    }
    return `${field.label}: ${fmt(val)}`;
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
