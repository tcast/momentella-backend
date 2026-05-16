-- Singleton footer config — admin can edit columns/links/contact via /admin/footer.
CREATE TABLE "site_footer_config" (
    "id"        TEXT NOT NULL DEFAULT 'default',
    "config"    JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "site_footer_config_pkey" PRIMARY KEY ("id")
);
