-- Phase 1: real Trip lifecycle.

-- 1. Expand TripStatus with new canonical values. Old values stay legal
--    (no rows yet but defensive); the app uses the new vocabulary going
--    forward. Adding values is non-blocking on Postgres 12+.
ALTER TYPE "TripStatus" ADD VALUE IF NOT EXISTS 'LEAD';
ALTER TYPE "TripStatus" ADD VALUE IF NOT EXISTS 'PLANNING';
ALTER TYPE "TripStatus" ADD VALUE IF NOT EXISTS 'BOOKED';

-- 2. New TripKind enum.
CREATE TYPE "TripKind" AS ENUM ('FULL_SERVICE', 'ITINERARY_ONLY', 'CONSULT');

-- 3. New columns on Trip.
ALTER TABLE "Trip"
  ADD COLUMN     "kind"                     "TripKind" NOT NULL DEFAULT 'FULL_SERVICE',
  ADD COLUMN     "homeAirportIata"          TEXT,
  ADD COLUMN     "partyAdults"              INTEGER,
  ADD COLUMN     "partyChildren"            INTEGER,
  ADD COLUMN     "partyChildAges"           JSONB,
  ADD COLUMN     "budgetTier"               TEXT,
  ADD COLUMN     "destinations"             JSONB,
  ADD COLUMN     "originIntakeSubmissionId" TEXT;

-- New indexes / FK / uniqueness.
CREATE UNIQUE INDEX "Trip_originIntakeSubmissionId_key"
  ON "Trip"("originIntakeSubmissionId");
CREATE INDEX "Trip_status_idx" ON "Trip"("status");
CREATE INDEX "Trip_kind_idx"   ON "Trip"("kind");

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_originIntakeSubmissionId_fkey"
  FOREIGN KEY ("originIntakeSubmissionId")
  REFERENCES "intake_submission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. trip_note table (threaded internal notes, mirrors intake_submission_note).
CREATE TABLE "trip_note" (
  "id"         TEXT NOT NULL,
  "tripId"     TEXT NOT NULL,
  "authorId"   TEXT,
  "authorName" TEXT,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trip_note_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trip_note_tripId_idx" ON "trip_note"("tripId");

ALTER TABLE "trip_note"
  ADD CONSTRAINT "trip_note_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
