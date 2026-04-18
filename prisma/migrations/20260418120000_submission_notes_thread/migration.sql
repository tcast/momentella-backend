-- CreateTable
CREATE TABLE "intake_submission_note" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_submission_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_submission_note_submissionId_idx" ON "intake_submission_note"("submissionId");

-- AddForeignKey
ALTER TABLE "intake_submission_note"
ADD CONSTRAINT "intake_submission_note_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "intake_submission"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing single-notes column into the thread as the first entry.
-- cuid generation is done on the app side; here we use gen_random_uuid() which
-- the `pgcrypto` extension exposes. Safe to call even if already enabled.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

INSERT INTO "intake_submission_note" ("id", "submissionId", "authorId", "authorName", "body", "createdAt", "updatedAt")
SELECT
  'note_' || replace(gen_random_uuid()::text, '-', ''),
  "id",
  NULL,
  'Imported (legacy note)',
  "notes",
  "updatedAt",
  "updatedAt"
FROM "intake_submission"
WHERE "notes" IS NOT NULL AND length(trim("notes")) > 0;
