BEGIN;

-- Link the current promotion cycle to its administrative record. Existing
-- cycles deliberately remain unlinked: timestamps do not prove correspondence.
ALTER TABLE "CirclePromotionRequest" ADD COLUMN "upgradeRequestId" TEXT;
CREATE UNIQUE INDEX "CirclePromotionRequest_upgradeRequestId_key"
  ON "CirclePromotionRequest"("upgradeRequestId");
ALTER TABLE "CirclePromotionRequest" ADD CONSTRAINT "CirclePromotionRequest_upgradeRequestId_fkey"
  FOREIGN KEY ("upgradeRequestId") REFERENCES "CircleUpgradeRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
