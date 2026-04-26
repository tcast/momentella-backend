-- Phase 3: proposals (versioned trip snapshots) + per-trip message threads.

-- 1. ProposalStatus enum.
CREATE TYPE "ProposalStatus" AS ENUM (
  'SENT',
  'APPROVED',
  'CHANGES_REQUESTED',
  'WITHDRAWN'
);

-- 2. Proposal table.
CREATE TABLE "proposal" (
  "id"              TEXT NOT NULL,
  "tripId"          TEXT NOT NULL,
  "version"         INTEGER NOT NULL,
  "schema"          JSONB NOT NULL,
  "status"          "ProposalStatus" NOT NULL DEFAULT 'SENT',
  "message"         TEXT,
  "publishedById"   TEXT,
  "publishedByName" TEXT,
  "respondedAt"     TIMESTAMP(3),
  "responderId"     TEXT,
  "responderName"   TEXT,
  "responseNote"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "proposal_tripId_version_key" ON "proposal"("tripId", "version");
CREATE INDEX "proposal_tripId_idx" ON "proposal"("tripId");

ALTER TABLE "proposal"
  ADD CONSTRAINT "proposal_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. TripMessage table.
CREATE TABLE "trip_message" (
  "id"         TEXT NOT NULL,
  "tripId"     TEXT NOT NULL,
  "authorId"   TEXT,
  "authorName" TEXT,
  "authorRole" TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trip_message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trip_message_tripId_createdAt_idx"
  ON "trip_message"("tripId", "createdAt");

ALTER TABLE "trip_message"
  ADD CONSTRAINT "trip_message_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
