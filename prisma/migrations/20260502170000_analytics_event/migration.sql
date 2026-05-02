-- Anonymous analytics: one row per pageview ping. Daily-salted ipHash
-- is used to compute unique visitors without retaining raw IPs.
CREATE TABLE "analytics_event" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "pathFull" TEXT,
    "title" TEXT,
    "referrer" TEXT,
    "referrerHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "browser" TEXT,
    "browserVersion" TEXT,
    "os" TEXT,
    "device" TEXT,
    "durationMs" INTEGER,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analytics_event_createdAt_idx"    ON "analytics_event"("createdAt");
CREATE INDEX "analytics_event_visitorId_idx"   ON "analytics_event"("visitorId");
CREATE INDEX "analytics_event_sessionId_idx"   ON "analytics_event"("sessionId");
CREATE INDEX "analytics_event_userId_idx"      ON "analytics_event"("userId");
CREATE INDEX "analytics_event_path_idx"        ON "analytics_event"("path");
CREATE INDEX "analytics_event_country_idx"     ON "analytics_event"("country");
CREATE INDEX "analytics_event_referrerHost_idx" ON "analytics_event"("referrerHost");

ALTER TABLE "analytics_event"
  ADD CONSTRAINT "analytics_event_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
