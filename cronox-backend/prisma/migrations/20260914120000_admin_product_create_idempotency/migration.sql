-- Persist administrative product-creation request keys so network retries are
-- atomic and cannot create duplicate products.
CREATE TABLE "AdminProductCreateRequest" (
    "id" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "productId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminProductCreateRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminProductCreateRequest_idempotencyKey_key"
ON "AdminProductCreateRequest"("idempotencyKey");
CREATE UNIQUE INDEX "AdminProductCreateRequest_productId_key"
ON "AdminProductCreateRequest"("productId");
CREATE INDEX "AdminProductCreateRequest_createdAt_idx"
ON "AdminProductCreateRequest"("createdAt");

ALTER TABLE "AdminProductCreateRequest"
ADD CONSTRAINT "AdminProductCreateRequest_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
