/**
 * Convert an IntakeSubmission into a Trip + (when needed) a Client User row.
 *
 * Pulls travel basics out of the answers using field-type heuristics so this
 * works for any intake form, not just `family-trip`. Idempotent: if the
 * submission has already been converted, returns the existing trip.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import {
  parseIntakeFormSchema,
  type FormField,
  type IntakeFormSchema,
} from "./intake-schema.js";

function newUserId(): string {
  // Match the shape of better-auth-generated user IDs: ~32 char URL-safe.
  return randomBytes(24).toString("base64url").slice(0, 32);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickName(
  schema: IntakeFormSchema | null,
  responses: Record<string, unknown>,
  email: string,
): string {
  if (schema) {
    for (const f of schema.fields) {
      if (f.type === "text" && /name/i.test(f.id + " " + f.label)) {
        const v = responses[f.id];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  // Fallback to the local part of the email, title-cased.
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function pickAirportIata(
  schema: IntakeFormSchema | null,
  responses: Record<string, unknown>,
): string | null {
  if (!schema) return null;
  for (const f of schema.fields) {
    if (f.type !== "airport") continue;
    const o = asRecord(responses[f.id]);
    if (o && typeof o.iata === "string") return o.iata;
  }
  return null;
}

interface TripBasics {
  startsOn: Date | null;
  endsOn: Date | null;
  homeAirportIata: string | null;
  partyAdults: number | null;
  partyChildren: number | null;
  partyChildAges: number[] | null;
  budgetTier: string | null;
  destinations: unknown[] | null;
  summary: string | null;
}

function pickBasics(
  schema: IntakeFormSchema | null,
  responses: Record<string, unknown>,
): TripBasics {
  const out: TripBasics = {
    startsOn: null,
    endsOn: null,
    homeAirportIata: null,
    partyAdults: null,
    partyChildren: null,
    partyChildAges: null,
    budgetTier: null,
    destinations: null,
    summary: null,
  };
  if (!schema) return out;

  function asNumber(v: unknown): number | null {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function asDate(v: unknown): Date | null {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00.000Z`);
    return Number.isNaN(d.valueOf()) ? null : d;
  }

  for (const f of schema.fields as FormField[]) {
    const val = responses[f.id];
    if (val === undefined || val === null) continue;

    if (f.type === "airport") {
      out.homeAirportIata = pickAirportIata(schema, responses);
      continue;
    }
    if (f.type === "destination") {
      const arr = Array.isArray(val) ? val : [val];
      out.destinations = arr.filter((x) => x && typeof x === "object");
      continue;
    }
    if (f.type === "travel_party") {
      const tp = asRecord(val);
      if (tp) {
        out.partyAdults = asNumber(tp.adults);
        out.partyChildren = asNumber(tp.children);
        if (Array.isArray(tp.childAges)) {
          out.partyChildAges = tp.childAges
            .map(asNumber)
            .filter((n): n is number => n !== null);
        }
      }
      continue;
    }
    if (f.type === "date") {
      // Heuristic: ids matching start/depart go to startsOn, end/return go to endsOn.
      const idLow = f.id.toLowerCase();
      if (!out.startsOn && /(start|depart|earliest)/.test(idLow)) {
        out.startsOn = asDate(val);
      } else if (!out.endsOn && /(end|return|latest)/.test(idLow)) {
        out.endsOn = asDate(val);
      }
      continue;
    }
    if (f.type === "select" && /budget/.test(f.id)) {
      if (typeof val === "string") out.budgetTier = val;
      continue;
    }
  }
  return out;
}

function buildTripTitle(
  basics: TripBasics,
  fallbackName: string,
): string {
  const dest = Array.isArray(basics.destinations)
    ? basics.destinations
        .map((d) => {
          const o = asRecord(d);
          return o && typeof o.name === "string" ? o.name : null;
        })
        .filter((s): s is string => !!s)
    : [];
  if (dest.length > 0) {
    return `${fallbackName} — ${dest.slice(0, 2).join(" + ")}${
      dest.length > 2 ? ` +${dest.length - 2}` : ""
    }`;
  }
  return `${fallbackName}'s trip`;
}

export interface ConvertResult {
  trip: { id: string };
  clientUser: { id: string; email: string; name: string; createdNow: boolean };
  alreadyConverted: boolean;
}

/**
 * Idempotent intake → trip conversion. If `submissionId` already has a
 * `convertedTrip`, that trip is returned untouched.
 */
export async function convertIntakeToTrip(
  submissionId: string,
): Promise<ConvertResult> {
  const sub = await prisma.intakeSubmission.findUnique({
    where: { id: submissionId },
    include: { convertedTrip: true, formVersion: true },
  });
  if (!sub) throw new Error("Intake submission not found");

  if (sub.convertedTrip) {
    const tripId = sub.convertedTrip.id;
    return {
      trip: { id: tripId },
      clientUser: sub.clientId
        ? await prisma.user
            .findUnique({ where: { id: sub.clientId } })
            .then((u) =>
              u
                ? { id: u.id, email: u.email, name: u.name, createdNow: false }
                : { id: sub.clientId!, email: sub.email, name: "", createdNow: false },
            )
        : { id: "", email: sub.email, name: "", createdNow: false },
      alreadyConverted: true,
    };
  }

  const schema = parseIntakeFormSchema(sub.formVersion.schema);
  const responses =
    sub.responses && typeof sub.responses === "object"
      ? (sub.responses as Record<string, unknown>)
      : {};

  const email = sub.email.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  let createdNow = false;
  if (!user) {
    const displayName = pickName(schema, responses, email);
    user = await prisma.user.create({
      data: {
        id: newUserId(),
        email,
        name: displayName,
        emailVerified: false,
        role: "client",
      },
    });
    createdNow = true;
  } else if (!user.role) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: "client" },
    });
  }

  const basics = pickBasics(schema, responses);
  const title = buildTripTitle(basics, user.name || email);

  const trip = await prisma.trip.create({
    data: {
      clientId: user.id,
      title,
      kind: "FULL_SERVICE",
      status: "LEAD",
      startsOn: basics.startsOn,
      endsOn: basics.endsOn,
      homeAirportIata: basics.homeAirportIata,
      partyAdults: basics.partyAdults,
      partyChildren: basics.partyChildren,
      partyChildAges: (basics.partyChildAges ?? undefined) as unknown as
        | object
        | undefined,
      budgetTier: basics.budgetTier,
      destinations: (basics.destinations ?? undefined) as unknown as
        | object
        | undefined,
      originIntakeSubmissionId: sub.id,
    },
  });

  // Backfill the submission's clientId so future submissions from the same
  // person are pre-linked too.
  if (!sub.clientId) {
    await prisma.intakeSubmission.update({
      where: { id: sub.id },
      data: { clientId: user.id },
    });
  }

  return {
    trip: { id: trip.id },
    clientUser: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdNow,
    },
    alreadyConverted: false,
  };
}
