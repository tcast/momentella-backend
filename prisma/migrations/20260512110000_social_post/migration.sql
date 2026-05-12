-- AI-assisted social media post generator.
CREATE TABLE "social_post" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "campaignKey" TEXT,
    "theme" TEXT,
    "destination" TEXT,
    "briefing" TEXT,
    "tone" TEXT,
    "goal" TEXT,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "hook" TEXT,
    "script" JSONB,
    "cta" TEXT,
    "ctaHref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledFor" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "postedUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_post_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_post_image" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "slideCaption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_post_image_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "social_post_status_idx"   ON "social_post"("status");
CREATE INDEX "social_post_platform_idx" ON "social_post"("platform");
CREATE INDEX "social_post_createdAt_idx" ON "social_post"("createdAt");
CREATE INDEX "social_post_image_postId_idx" ON "social_post_image"("postId");

ALTER TABLE "social_post"
  ADD CONSTRAINT "social_post_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_post_image"
  ADD CONSTRAINT "social_post_image_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "social_post"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
