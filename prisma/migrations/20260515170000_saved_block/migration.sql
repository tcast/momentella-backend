-- Reusable content-block library for the page builder.
CREATE TABLE "saved_block" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "blockType" TEXT NOT NULL,
    "block" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "saved_block_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_block_blockType_idx" ON "saved_block"("blockType");
CREATE INDEX "saved_block_category_idx"  ON "saved_block"("category");
CREATE INDEX "saved_block_updatedAt_idx" ON "saved_block"("updatedAt");

ALTER TABLE "saved_block"
  ADD CONSTRAINT "saved_block_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
