-- CreateTable
CREATE TABLE "intake_form" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_form_version" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "schema" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_form_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TYPE "IntakeSubmissionStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESPONDED', 'CLOSED');

CREATE TABLE "intake_submission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "IntakeSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "responses" JSONB NOT NULL,
    "clientId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intake_form_slug_key" ON "intake_form"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "intake_form_version_formId_version_key" ON "intake_form_version"("formId", "version");

-- CreateIndex
CREATE INDEX "intake_form_version_formId_idx" ON "intake_form_version"("formId");

-- CreateIndex
CREATE INDEX "intake_submission_formId_idx" ON "intake_submission"("formId");

-- CreateIndex
CREATE INDEX "intake_submission_email_idx" ON "intake_submission"("email");

-- CreateIndex
CREATE INDEX "intake_submission_clientId_idx" ON "intake_submission"("clientId");

-- AddForeignKey
ALTER TABLE "intake_form_version" ADD CONSTRAINT "intake_form_version_formId_fkey" FOREIGN KEY ("formId") REFERENCES "intake_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "intake_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "intake_form_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
