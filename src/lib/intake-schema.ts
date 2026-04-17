/** Stored in IntakeFormVersion.schema — versioned JSON definition for dynamic intake forms. */

export const FORM_SCHEMA_VERSION = 1 as const;

export type FormFieldType =
  | "section"
  | "text"
  | "email"
  | "tel"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "travel_party"
  | "airport"
  | "destination";

export interface FieldOption {
  value: string;
  label: string;
}

interface FormFieldBase {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  required?: boolean;
}

export interface SectionField extends FormFieldBase {
  type: "section";
}

export interface TextField extends FormFieldBase {
  type: "text" | "email" | "tel" | "textarea";
  placeholder?: string;
}

export interface NumberField extends FormFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

export interface DateField extends FormFieldBase {
  type: "date";
}

export interface SelectField extends FormFieldBase {
  type: "select" | "multiselect";
  options: FieldOption[];
}

export interface CheckboxField extends FormFieldBase {
  type: "checkbox";
}

export interface TravelPartyField extends FormFieldBase {
  type: "travel_party";
  minAdults?: number;
  maxAdults?: number;
  maxChildren?: number;
  /** When true, expect childAges length === children count */
  collectChildAges: boolean;
}

/** Single-airport picker. Value saved as { id, iata, name, city, country }. */
export interface AirportField extends FormFieldBase {
  type: "airport";
}

/**
 * Destination picker sourced from the admin `destination` catalog.
 * Value: { id, slug, name, type } if `allowMultiple` is false,
 * otherwise an array of those objects.
 */
export interface DestinationField extends FormFieldBase {
  type: "destination";
  allowMultiple?: boolean;
}

export type FormField =
  | SectionField
  | TextField
  | NumberField
  | DateField
  | SelectField
  | CheckboxField
  | TravelPartyField
  | AirportField
  | DestinationField;

export interface IntakeFormSchema {
  version: typeof FORM_SCHEMA_VERSION;
  fields: FormField[];
}

export function parseIntakeFormSchema(raw: unknown): IntakeFormSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== FORM_SCHEMA_VERSION) return null;
  if (!Array.isArray(o.fields)) return null;
  return { version: FORM_SCHEMA_VERSION, fields: o.fields as FormField[] };
}

/** Starter template for a family / boutique trip intake (editable in admin). */
export function defaultFamilyTripSchema(): IntakeFormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    fields: [
      {
        id: "sec_contact",
        type: "section",
        label: "Contact",
        description: "How we reach you",
      },
      {
        id: "contact_name",
        type: "text",
        label: "Full name",
        required: true,
      },
      {
        id: "contact_email",
        type: "email",
        label: "Email",
        required: true,
      },
      {
        id: "contact_phone",
        type: "tel",
        label: "Phone",
        description: "Include country code if outside the US",
      },
      {
        id: "sec_party",
        type: "section",
        label: "Who is traveling",
      },
      {
        id: "travel_party",
        type: "travel_party",
        label: "Travelers",
        required: true,
        minAdults: 1,
        maxAdults: 12,
        maxChildren: 10,
        collectChildAges: true,
      },
      {
        id: "sec_trip",
        type: "section",
        label: "Trip vision",
      },
      {
        id: "destinations",
        type: "destination",
        label: "Destinations or regions of interest",
        description:
          "Start typing a country, city, park, or region — add as many as you like.",
        allowMultiple: true,
      },
      {
        id: "home_airport",
        type: "airport",
        label: "Home airport",
        description:
          "Type a city, airport name, or 3-letter code (e.g. DTW).",
      },
      {
        id: "date_flex",
        type: "select",
        label: "Timing",
        required: true,
        options: [
          { value: "fixed", label: "We have specific dates" },
          { value: "month", label: "We have a month / season in mind" },
          { value: "flexible", label: "Fully flexible" },
        ],
      },
      {
        id: "date_start",
        type: "date",
        label: "Earliest departure",
      },
      {
        id: "date_end",
        type: "date",
        label: "Latest return",
      },
      {
        id: "trip_length",
        type: "select",
        label: "Approximate trip length",
        options: [
          { value: "lt_1w", label: "Under 1 week" },
          { value: "1_2w", label: "1–2 weeks" },
          { value: "2_3w", label: "2–3 weeks" },
          { value: "3w_plus", label: "3+ weeks" },
        ],
      },
      {
        id: "budget",
        type: "select",
        label: "Budget range (total, excluding flights if unsure)",
        options: [
          { value: "under_10k", label: "Under $10k" },
          { value: "10_25k", label: "$10k – $25k" },
          { value: "25_50k", label: "$25k – $50k" },
          { value: "50k_plus", label: "$50k+" },
          { value: "unsure", label: "Prefer to discuss" },
        ],
      },
      {
        id: "pace",
        type: "select",
        label: "Pace",
        options: [
          { value: "relaxed", label: "Slow & relaxed" },
          { value: "balanced", label: "Balanced" },
          { value: "active", label: "Packed & active" },
        ],
      },
      {
        id: "lodging",
        type: "multiselect",
        label: "Lodging style",
        options: [
          { value: "boutique", label: "Boutique hotels" },
          { value: "villa", label: "Private villa / rental" },
          { value: "resort", label: "Resort" },
          { value: "apartment", label: "Apartments" },
          { value: "mixed", label: "Mix / unsure" },
        ],
      },
      {
        id: "interests",
        type: "multiselect",
        label: "Interests & priorities",
        options: [
          { value: "family_friendly", label: "Kid-friendly activities" },
          { value: "food_wine", label: "Food & wine" },
          { value: "culture", label: "Culture & museums" },
          { value: "nature", label: "Nature & outdoors" },
          { value: "beach", label: "Beach time" },
          { value: "adventure", label: "Soft adventure" },
        ],
      },
      {
        id: "accessibility",
        type: "textarea",
        label: "Accessibility or mobility needs",
        description: "Strollers, wheelchairs, dietary, etc.",
      },
      {
        id: "celebration",
        type: "text",
        label: "Celebration or special occasion",
        placeholder: "Anniversary, birthday, graduation…",
      },
      {
        id: "notes",
        type: "textarea",
        label: "Anything else we should know",
      },
      {
        id: "referral",
        type: "select",
        label: "How did you hear about Momentella?",
        options: [
          { value: "referral", label: "Referral" },
          { value: "instagram", label: "Instagram" },
          { value: "search", label: "Search" },
          { value: "other", label: "Other" },
        ],
      },
    ],
  };
}
