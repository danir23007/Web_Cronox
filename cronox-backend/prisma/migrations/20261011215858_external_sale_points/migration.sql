-- CreateTable
CREATE TABLE "SalePoint" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "venue" TEXT NOT NULL DEFAULT '',
    "startsOn" TEXT,
    "endsOn" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "commissionBp" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointSale" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "soldAt" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" JSONB NOT NULL,

    CONSTRAINT "PointSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointEntry" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "saleId" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "lines" JSONB NOT NULL,
    "expenseCents" INTEGER NOT NULL DEFAULT 0,
    "reversesId" TEXT,

    CONSTRAINT "PointEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointSale_pointId_soldAt_idx" ON "PointSale"("pointId", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointEntry_requestKey_key" ON "PointEntry"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PointEntry_reversesId_key" ON "PointEntry"("reversesId");

-- CreateIndex
CREATE INDEX "PointEntry_pointId_occurredAt_idx" ON "PointEntry"("pointId", "occurredAt");

-- CreateIndex
CREATE INDEX "PointEntry_occurredAt_idx" ON "PointEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "PointEntry_saleId_createdAt_idx" ON "PointEntry"("saleId", "createdAt");

-- AddForeignKey
ALTER TABLE "PointSale" ADD CONSTRAINT "PointSale_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "SalePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "SalePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PointSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SalePoint" ADD CONSTRAINT "SalePoint_commission_check" CHECK ("commissionBp" BETWEEN 0 AND 10000);
ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_kind_check" CHECK (kind IN ('POINT_CREATE','POINT_EDIT','SALE','CORRECTION','RETURN','EXPENSE','EXPENSE_REVERSAL'));
ALTER TABLE "SalePoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PointSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PointEntry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SalePoint", "PointSale", "PointEntry" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "SalePoint", "PointSale", "PointEntry" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "SalePoint", "PointSale", "PointEntry" FROM authenticated;
  END IF;
END $$;
CREATE FUNCTION cronox_point_entry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PointEntry is append-only; record a correction or reversal'; END $$;
CREATE TRIGGER point_entry_immutable BEFORE UPDATE OR DELETE ON "PointEntry"
FOR EACH ROW EXECUTE FUNCTION cronox_point_entry_immutable();
