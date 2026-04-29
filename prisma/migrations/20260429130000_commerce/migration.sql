-- Commerce: products, orders, gift certificates, trip linkage.

CREATE TYPE "ProductKind" AS ENUM ('ITINERARY_PLANNING');

CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING',
  'PAID',
  'CANCELLED',
  'FAILED',
  'REFUNDED'
);

-- Product
CREATE TABLE "product" (
  "id"            TEXT          NOT NULL,
  "slug"          TEXT          NOT NULL,
  "kind"          "ProductKind" NOT NULL,
  "name"          TEXT          NOT NULL,
  "description"   TEXT,
  "itineraryDays" INTEGER,
  "priceCents"    INTEGER       NOT NULL,
  "stripePriceId" TEXT,
  "active"        BOOLEAN       NOT NULL DEFAULT true,
  "sortOrder"     INTEGER       NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_slug_key" ON "product"("slug");

-- Order
CREATE TABLE "order" (
  "id"                       TEXT          NOT NULL,
  "buyerId"                  TEXT,
  "buyerEmail"               TEXT          NOT NULL,
  "buyerName"                TEXT,
  "productId"                TEXT          NOT NULL,
  "unitPriceCents"           INTEGER       NOT NULL,
  "quantity"                 INTEGER       NOT NULL DEFAULT 1,
  "totalCents"               INTEGER       NOT NULL,
  "status"                   "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "isGift"                   BOOLEAN       NOT NULL DEFAULT false,
  "stripeCheckoutSessionId"  TEXT,
  "stripePaymentIntentId"    TEXT,
  "paidAt"                   TIMESTAMP(3),
  "refundedAt"               TIMESTAMP(3),
  "notes"                    TEXT,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_stripeCheckoutSessionId_key"
  ON "order"("stripeCheckoutSessionId");
CREATE INDEX "order_buyerId_idx"    ON "order"("buyerId");
CREATE INDEX "order_buyerEmail_idx" ON "order"("buyerEmail");
CREATE INDEX "order_status_idx"     ON "order"("status");

ALTER TABLE "order"
  ADD CONSTRAINT "order_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order"
  ADD CONSTRAINT "order_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Gift certificate
CREATE TABLE "gift_certificate" (
  "id"             TEXT         NOT NULL,
  "orderId"        TEXT         NOT NULL,
  "code"           TEXT         NOT NULL,
  "recipientEmail" TEXT         NOT NULL,
  "recipientName"  TEXT,
  "message"        TEXT,
  "scheduledFor"   TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "redeemedAt"     TIMESTAMP(3),
  "redeemedById"   TEXT,
  "redeemedTripId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gift_certificate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gift_certificate_orderId_key"
  ON "gift_certificate"("orderId");
CREATE UNIQUE INDEX "gift_certificate_code_key"
  ON "gift_certificate"("code");
CREATE UNIQUE INDEX "gift_certificate_redeemedTripId_key"
  ON "gift_certificate"("redeemedTripId");
CREATE INDEX "gift_certificate_recipientEmail_idx"
  ON "gift_certificate"("recipientEmail");
CREATE INDEX "gift_certificate_redeemedById_idx"
  ON "gift_certificate"("redeemedById");

ALTER TABLE "gift_certificate"
  ADD CONSTRAINT "gift_certificate_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gift_certificate"
  ADD CONSTRAINT "gift_certificate_redeemedById_fkey"
  FOREIGN KEY ("redeemedById") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Trip linkage to commerce
ALTER TABLE "Trip"
  ADD COLUMN     "fulfilledByOrderId"   TEXT,
  ADD COLUMN     "productSlug"          TEXT,
  ADD COLUMN     "itineraryDaysAllowed" INTEGER;
CREATE INDEX "Trip_fulfilledByOrderId_idx"
  ON "Trip"("fulfilledByOrderId");

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_fulfilledByOrderId_fkey"
  FOREIGN KEY ("fulfilledByOrderId") REFERENCES "order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gift_certificate"
  ADD CONSTRAINT "gift_certificate_redeemedTripId_fkey"
  FOREIGN KEY ("redeemedTripId") REFERENCES "Trip"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
