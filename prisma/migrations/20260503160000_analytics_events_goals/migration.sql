-- Goal / event tracking columns for analytics_event. NULL eventType
-- means a plain pageview (existing rows). Indexed for "Top events"
-- lookups.
ALTER TABLE "analytics_event"
  ADD COLUMN "eventType"  TEXT,
  ADD COLUMN "eventValue" INTEGER;

CREATE INDEX "analytics_event_eventType_idx" ON "analytics_event"("eventType");
