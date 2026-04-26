/** Stored on Trip.itinerarySchema. Mirrored on the frontend. */

export const ITINERARY_SCHEMA_VERSION = 1 as const;

export type ItemKind =
  | "lodging"
  | "activity"
  | "transit"
  | "meal"
  | "note";

export type BookedBy = "us" | "them" | "tbd";

export interface ItineraryItem {
  id: string;
  kind: ItemKind;
  title: string;
  description?: string;
  /** "HH:MM" 24-hour. */
  startTime?: string;
  endTime?: string;
  location?: string;
  vendorName?: string;
  vendorUrl?: string;
  bookingRef?: string;
  /** Whole dollars (or whatever currency the trip uses). Simple for v1. */
  cost?: number;
  imageUrl?: string;
  bookedBy?: BookedBy;
}

export interface ItineraryDay {
  id: string;
  /** "YYYY-MM-DD" if a real date is known. */
  date?: string;
  title?: string;
  summary?: string;
  items: ItineraryItem[];
}

export interface ItinerarySchema {
  version: typeof ITINERARY_SCHEMA_VERSION;
  summary?: string;
  days: ItineraryDay[];
}

const VALID_KINDS = new Set<ItemKind>([
  "lodging",
  "activity",
  "transit",
  "meal",
  "note",
]);

export function parseItinerarySchema(raw: unknown): ItinerarySchema | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== ITINERARY_SCHEMA_VERSION) return null;
  if (!Array.isArray(o.days)) return null;
  for (const d of o.days) {
    if (!d || typeof d !== "object") return null;
    const day = d as Record<string, unknown>;
    if (typeof day.id !== "string") return null;
    if (!Array.isArray(day.items)) return null;
    for (const it of day.items) {
      if (!it || typeof it !== "object") return null;
      const item = it as Record<string, unknown>;
      if (typeof item.id !== "string") return null;
      if (typeof item.kind !== "string" || !VALID_KINDS.has(item.kind as ItemKind))
        return null;
      if (typeof item.title !== "string") return null;
    }
  }
  return {
    version: ITINERARY_SCHEMA_VERSION,
    summary: typeof o.summary === "string" ? o.summary : undefined,
    days: o.days as ItineraryDay[],
  };
}
