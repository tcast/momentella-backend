-- Track Resend email delivery / open / bounce events on gift certificates.
ALTER TABLE "gift_certificate"
  ADD COLUMN "resendEmailId" TEXT,
  ADD COLUMN "deliveredAt"   TIMESTAMP(3),
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "lastOpenedAt"  TIMESTAMP(3),
  ADD COLUMN "openCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bouncedAt"     TIMESTAMP(3),
  ADD COLUMN "bounceReason"  TEXT;

CREATE INDEX "gift_certificate_resendEmailId_idx"
  ON "gift_certificate"("resendEmailId");
