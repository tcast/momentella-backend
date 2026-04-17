import type { FormField, IntakeFormSchema } from "./intake-schema.js";

function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return !Number.isNaN(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export function validateIntakeResponses(
  schema: IntakeFormSchema,
  responses: Record<string, unknown>,
): string | null {
  for (const field of schema.fields as FormField[]) {
    if (field.type === "section") continue;

    const val = responses[field.id];

    if (field.required && !isNonEmpty(val)) {
      return `Required: ${field.label}`;
    }

    if (val === undefined || val === null) continue;

    switch (field.type) {
      case "number": {
        const n = typeof val === "number" ? val : Number(val);
        if (Number.isNaN(n)) return `${field.label}: invalid number`;
        if (field.min !== undefined && n < field.min) return `${field.label}: must be ≥ ${field.min}`;
        if (field.max !== undefined && n > field.max) return `${field.label}: must be ≤ ${field.max}`;
        break;
      }
      case "checkbox": {
        if (typeof val !== "boolean") return `${field.label}: invalid`;
        break;
      }
      case "select": {
        if (typeof val !== "string") return `${field.label}: invalid`;
        const ok = field.options.some((o) => o.value === val);
        if (!ok) return `${field.label}: invalid option`;
        break;
      }
      case "multiselect": {
        if (!Array.isArray(val)) return `${field.label}: must be a list`;
        const set = new Set(field.options.map((o) => o.value));
        for (const item of val) {
          if (typeof item !== "string" || !set.has(item)) {
            return `${field.label}: invalid option`;
          }
        }
        break;
      }
      case "travel_party": {
        if (typeof val !== "object" || val === null) {
          return `${field.label}: invalid travelers`;
        }
        const tp = val as Record<string, unknown>;
        const adults = typeof tp.adults === "number" ? tp.adults : Number(tp.adults);
        const children =
          typeof tp.children === "number" ? tp.children : Number(tp.children);
        if (!Number.isInteger(adults) || adults < (field.minAdults ?? 1)) {
          return `${field.label}: adults must be a whole number ≥ ${field.minAdults ?? 1}`;
        }
        if (
          field.maxAdults !== undefined &&
          Number.isInteger(adults) &&
          adults > field.maxAdults
        ) {
          return `${field.label}: too many adults`;
        }
        if (
          !Number.isInteger(children) ||
          children < 0 ||
          (field.maxChildren !== undefined && children > field.maxChildren)
        ) {
          return `${field.label}: invalid number of children`;
        }
        if (field.collectChildAges) {
          const ages = tp.childAges;
          if (children > 0) {
            if (!Array.isArray(ages) || ages.length !== children) {
              return `${field.label}: provide one age per child`;
            }
            for (const a of ages) {
              const n = typeof a === "number" ? a : Number(a);
              if (!Number.isFinite(n) || n < 0 || n > 21) {
                return `${field.label}: child ages must be 0–21`;
              }
            }
          } else if (ages !== undefined && ages !== null) {
            if (Array.isArray(ages) && ages.length > 0) {
              return `${field.label}: child ages should be empty when there are no children`;
            }
          }
        }
        break;
      }
      case "date": {
        if (typeof val !== "string") return `${field.label}: invalid date`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${field.label}: use YYYY-MM-DD`;
        break;
      }
      case "text":
      case "email":
      case "tel":
      case "textarea": {
        if (typeof val !== "string") return `${field.label}: invalid text`;
        if (field.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          return `${field.label}: invalid email`;
        }
        break;
      }
      case "airport": {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          return `${field.label}: please pick an airport from the list`;
        }
        const o = val as Record<string, unknown>;
        if (typeof o.id !== "string" || typeof o.iata !== "string") {
          return `${field.label}: please pick an airport from the list`;
        }
        break;
      }
      case "destination": {
        const checkOne = (v: unknown): string | null => {
          if (typeof v !== "object" || v === null || Array.isArray(v)) {
            return `${field.label}: please pick from the list`;
          }
          const o = v as Record<string, unknown>;
          if (typeof o.id !== "string" || typeof o.slug !== "string") {
            return `${field.label}: please pick from the list`;
          }
          return null;
        };
        if (field.allowMultiple) {
          if (!Array.isArray(val)) return `${field.label}: expected a list`;
          for (const item of val) {
            const err = checkOne(item);
            if (err) return err;
          }
        } else {
          const err = checkOne(val);
          if (err) return err;
        }
        break;
      }
      default: {
        const _exhaustive: never = field as never;
        return _exhaustive;
      }
    }
  }

  return null;
}

/** Strip unknown keys; keep only ids declared in schema (non-section). */
export function sanitizeResponses(
  schema: IntakeFormSchema,
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set<string>();
  for (const f of schema.fields) {
    if (f.type !== "section") allowed.add(f.id);
  }
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(responses, k)) {
      out[k] = responses[k];
    }
  }
  return out;
}
