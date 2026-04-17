-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('COUNTRY', 'REGION', 'CITY', 'AREA', 'PARK', 'RESORT', 'VENUE');

-- CreateTable
CREATE TABLE "airport" (
    "id" TEXT NOT NULL,
    "iata" TEXT NOT NULL,
    "icao" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airport_iata_key" ON "airport"("iata");
CREATE INDEX "airport_active_idx" ON "airport"("active");
CREATE INDEX "airport_city_idx" ON "airport"("city");
CREATE INDEX "airport_country_idx" ON "airport"("country");

-- CreateTable
CREATE TABLE "destination" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DestinationType" NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "aliases" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "destination_slug_key" ON "destination"("slug");
CREATE INDEX "destination_type_idx" ON "destination"("type");
CREATE INDEX "destination_country_idx" ON "destination"("country");
CREATE INDEX "destination_active_idx" ON "destination"("active");
