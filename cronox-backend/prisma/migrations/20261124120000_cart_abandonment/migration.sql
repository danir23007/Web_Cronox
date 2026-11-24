-- No backfill: historical carts cannot become eligible through deployment.
CREATE TABLE "CartAbandonment" (
  id TEXT PRIMARY KEY,
  "cartId" INTEGER NOT NULL REFERENCES "Cart"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "activityAt" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "readyAt" TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMPTZ(3),
  "sentAt" TIMESTAMPTZ(3),
  "messageId" TEXT,
  "errorCode" TEXT,
  CHECK ("dueAt">="activityAt"+interval '23 hours'),
  CHECK (status IN ('QUEUED','PROCESSING','SENT','CANCELLED','UNCERTAIN','FAILED'))
);
CREATE INDEX "CartAbandonment_due_idx" ON "CartAbandonment" (status,"readyAt");
CREATE INDEX "CartAbandonment_cart_idx" ON "CartAbandonment" ("cartId","activityAt");
CREATE UNIQUE INDEX "CartAbandonment_one_queued" ON "CartAbandonment" ("cartId") WHERE status='QUEUED';
ALTER TABLE "CartAbandonment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CartAbandonment" FROM PUBLIC;
