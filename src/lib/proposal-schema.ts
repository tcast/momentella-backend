/** Stored on Proposal.schema. Mirrored on the frontend. */

import type { ItinerarySchema } from "./itinerary-schema.js";

export const PROPOSAL_SCHEMA_VERSION = 1 as const;

export interface ProposalTripSnapshot {
  title: string;
  kind: string;
  status: string;
  destination: string | null;
  destinations: unknown[] | null;
  startsOn: string | null;
  endsOn: string | null;
  homeAirportIata: string | null;
  partyAdults: number | null;
  partyChildren: number | null;
  partyChildAges: number[] | null;
  budgetTier: string | null;
  summary: string | null;
}

export interface ProposalSchema {
  version: typeof PROPOSAL_SCHEMA_VERSION;
  trip: ProposalTripSnapshot;
  itinerary: ItinerarySchema;
}
