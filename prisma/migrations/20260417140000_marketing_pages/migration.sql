-- CreateTable
CREATE TABLE "marketing_page" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_page_slug_key" ON "marketing_page"("slug");

-- CreateTable
CREATE TABLE "marketing_page_version" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "schema" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_page_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_page_version_pageId_version_key" ON "marketing_page_version"("pageId", "version");
CREATE INDEX "marketing_page_version_pageId_idx" ON "marketing_page_version"("pageId");

-- AddForeignKey
ALTER TABLE "marketing_page_version"
ADD CONSTRAINT "marketing_page_version_pageId_fkey"
FOREIGN KEY ("pageId") REFERENCES "marketing_page"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
