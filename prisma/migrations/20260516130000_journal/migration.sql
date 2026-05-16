-- Journal: authors + articles. Article body reuses the same PageSchema
-- JSON shape as marketing pages.

CREATE TABLE "author" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "author_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "author_slug_key" ON "author"("slug");

CREATE TABLE "article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "excerpt" TEXT,
    "category" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "heroImageUrl" TEXT,
    "heroImageAlt" TEXT,
    "ogImageUrl" TEXT,
    "body" JSONB NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_slug_key" ON "article"("slug");
CREATE INDEX "article_status_idx"      ON "article"("status");
CREATE INDEX "article_publishedAt_idx" ON "article"("publishedAt");
CREATE INDEX "article_category_idx"    ON "article"("category");
CREATE INDEX "article_featured_idx"    ON "article"("featured");

ALTER TABLE "article"
  ADD CONSTRAINT "article_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "author"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
