-- Forward-only: legacy JWTs lack trustworthy activity metadata and must sign in once.
-- No existing users, addresses, carts, or session versions are modified.
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "refreshHash" TEXT NOT NULL,
    "previousRefreshHash" TEXT,
    "previousValidUntil" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "refreshIssuedAt" INTEGER NOT NULL,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_lastActivityAt_idx" ON "AuthSession"("lastActivityAt");
