-- Phase 4: bookings + documents.

CREATE TYPE "BookingKind" AS ENUM (
  'LODGING',
  'FLIGHT',
  'TRANSFER',
  'ACTIVITY',
  'CRUISE',
  'CAR_RENTAL',
  'RAIL',
  'INSURANCE',
  'OTHER'
);

CREATE TYPE "BookingStatus" AS ENUM (
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'CANCELLED'
);

CREATE TABLE "booking" (
  "id"          TEXT            NOT NULL,
  "tripId"      TEXT            NOT NULL,
  "kind"        "BookingKind"   NOT NULL,
  "status"      "BookingStatus" NOT NULL DEFAULT 'DRAFT',
  "title"       TEXT            NOT NULL,
  "vendorName"  TEXT,
  "vendorUrl"   TEXT,
  "bookingRef"  TEXT,
  "bookedBy"    TEXT,
  "startDate"   TIMESTAMP(3),
  "endDate"     TIMESTAMP(3),
  "cost"        DOUBLE PRECISION,
  "costNotes"   TEXT,
  "description" TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "booking_tripId_idx" ON "booking"("tripId");
CREATE INDEX "booking_status_idx" ON "booking"("status");

ALTER TABLE "booking"
  ADD CONSTRAINT "booking_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "trip_document" (
  "id"              TEXT    NOT NULL,
  "tripId"          TEXT    NOT NULL,
  "bookingId"       TEXT,
  "name"            TEXT    NOT NULL,
  "storageKey"      TEXT    NOT NULL,
  "url"             TEXT    NOT NULL,
  "contentType"     TEXT    NOT NULL,
  "size"            INTEGER NOT NULL,
  "visibleToClient" BOOLEAN NOT NULL DEFAULT true,
  "uploadedById"    TEXT,
  "uploadedByName"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "trip_document_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trip_document_tripId_idx" ON "trip_document"("tripId");
CREATE INDEX "trip_document_bookingId_idx" ON "trip_document"("bookingId");

ALTER TABLE "trip_document"
  ADD CONSTRAINT "trip_document_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_document"
  ADD CONSTRAINT "trip_document_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "booking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
