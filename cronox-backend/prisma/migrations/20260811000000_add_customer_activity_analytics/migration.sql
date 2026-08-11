-- Customer access history and consent-aware first-party behaviour analytics.
CREATE TYPE "AnalyticsConsentStatus" AS ENUM ('ACTIVE', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "DeviceClass" AS ENUM ('DESKTOP', 'MOBILE', 'TABLET', 'OTHER');
CREATE TYPE "CustomerActivityEventType" AS ENUM (
  'PRODUCT_VIEWED',
  'PRODUCT_ADDED_TO_CART',
  'PRODUCT_REMOVED_FROM_CART',
  'CART_QUANTITY_CHANGED',
  'FAVOURITE_ADDED',
  'FAVOURITE_REMOVED',
  'SEARCH_PERFORMED',
  'CATEGORY_VIEWED',
  'CHECKOUT_STARTED',
  'CHECKOUT_COMPLETED',
  'CHECKOUT_ABANDONED',
  'ACTIVE_TIME'
);

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "analyticsConsentStatus" "AnalyticsConsentStatus",
  ADD COLUMN "analyticsConsentVersion" TEXT,
  ADD COLUMN "analyticsConsentDecidedAt" TIMESTAMP(3),
  ADD COLUMN "analyticsFirstGrantedAt" TIMESTAMP(3),
  ADD COLUMN "analyticsLastGrantedAt" TIMESTAMP(3);

CREATE TABLE "UserLoginEvent" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "browserFamily" VARCHAR(40) NOT NULL,
  "browserMajorVersion" VARCHAR(12),
  "osFamily" VARCHAR(40) NOT NULL,
  "deviceClass" "DeviceClass" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserLoginEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsSession" (
  "id" UUID NOT NULL,
  "userId" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activeSeconds" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerActivityEvent" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "sessionId" UUID NOT NULL,
  "eventType" "CustomerActivityEventType" NOT NULL,
  "clientEventId" UUID,
  "productId" INTEGER,
  "variantId" INTEGER,
  "categorySlug" VARCHAR(80),
  "searchQuery" VARCHAR(80),
  "resultCount" INTEGER,
  "quantity" INTEGER,
  "previousQuantity" INTEGER,
  "activeSeconds" INTEGER,
  "checkoutSnapshotId" TEXT,
  "orderId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserLoginEvent_userId_createdAt_idx" ON "UserLoginEvent"("userId", "createdAt");
CREATE INDEX "UserLoginEvent_createdAt_idx" ON "UserLoginEvent"("createdAt");
CREATE INDEX "AnalyticsSession_userId_startedAt_idx" ON "AnalyticsSession"("userId", "startedAt");
CREATE INDEX "AnalyticsSession_userId_lastActivityAt_idx" ON "AnalyticsSession"("userId", "lastActivityAt");
CREATE INDEX "AnalyticsSession_lastActivityAt_idx" ON "AnalyticsSession"("lastActivityAt");
CREATE UNIQUE INDEX "CustomerActivityEvent_clientEventId_key" ON "CustomerActivityEvent"("clientEventId");
CREATE UNIQUE INDEX "CustomerActivityEvent_eventType_checkoutSnapshotId_key" ON "CustomerActivityEvent"("eventType", "checkoutSnapshotId");
CREATE INDEX "CustomerActivityEvent_userId_createdAt_idx" ON "CustomerActivityEvent"("userId", "createdAt");
CREATE INDEX "CustomerActivityEvent_userId_eventType_createdAt_idx" ON "CustomerActivityEvent"("userId", "eventType", "createdAt");
CREATE INDEX "CustomerActivityEvent_sessionId_createdAt_idx" ON "CustomerActivityEvent"("sessionId", "createdAt");
CREATE INDEX "CustomerActivityEvent_userId_productId_eventType_idx" ON "CustomerActivityEvent"("userId", "productId", "eventType");
CREATE INDEX "CustomerActivityEvent_createdAt_idx" ON "CustomerActivityEvent"("createdAt");

ALTER TABLE "UserLoginEvent" ADD CONSTRAINT "UserLoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_checkoutSnapshotId_fkey" FOREIGN KEY ("checkoutSnapshotId") REFERENCES "CheckoutSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerActivityEvent" ADD CONSTRAINT "CustomerActivityEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
