CREATE TABLE "CartOperation" (
  "cartId" INTEGER NOT NULL REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("cartId", "key")
);
CREATE TABLE "RequestRateWindow" (
  "key" VARCHAR(64) PRIMARY KEY,
  "hits" INTEGER NOT NULL,
  "resetsAt" TIMESTAMPTZ(3) NOT NULL,
  "blockedUntil" TIMESTAMPTZ(3)
);
CREATE INDEX "RequestRateWindow_resetsAt_idx" ON "RequestRateWindow"("resetsAt");
ALTER TABLE "CartOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestRateWindow" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CartOperation", "RequestRateWindow" FROM PUBLIC;
