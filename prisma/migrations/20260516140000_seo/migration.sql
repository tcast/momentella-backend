-- Phase 3 SEO/GEO infrastructure:
-- 1) Generic key/value site settings (verification tags, IndexNow key).
-- 2) IndexNow submission audit log.

CREATE TABLE "site_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "site_setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "indexnow_log" (
    "id" TEXT NOT NULL,
    "urls" TEXT[] NOT NULL,
    "status" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'auto',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "indexnow_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "indexnow_log_createdAt_idx" ON "indexnow_log"("createdAt");
