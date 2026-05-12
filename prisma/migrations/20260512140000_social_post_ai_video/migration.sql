-- Per-post HeyGen video job state (json blob keeps the model simple).
ALTER TABLE "social_post" ADD COLUMN "aiVideo" JSONB;
