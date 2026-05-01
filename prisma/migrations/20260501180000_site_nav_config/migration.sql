-- Editable site navigation config (single-row table).
CREATE TABLE "site_nav_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_nav_config_pkey" PRIMARY KEY ("id")
);
