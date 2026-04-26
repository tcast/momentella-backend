-- Phase 2: itinerary as a JSON document on Trip.
ALTER TABLE "Trip" ADD COLUMN "itinerarySchema" JSONB;
