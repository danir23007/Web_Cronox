CREATE TABLE "EmailChangeRequest" (
 "userId" INTEGER NOT NULL,
 "id" TEXT NOT NULL,
 "oldEmail" TEXT NOT NULL,
 "newEmail" TEXT NOT NULL,
 "sessionVersion" INTEGER NOT NULL,
 "stage" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL,
 "cancelHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "lastSentAt" TIMESTAMP(3) NOT NULL,
 "sendCount" INTEGER NOT NULL DEFAULT 1,
 "delivery" TEXT NOT NULL DEFAULT 'SENDING',
 "windowAt" TIMESTAMP(3) NOT NULL,
 "starts" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX "EmailChangeRequest_id_key" ON "EmailChangeRequest"("id");
CREATE UNIQUE INDEX "EmailChangeRequest_tokenHash_key" ON "EmailChangeRequest"("tokenHash");
CREATE UNIQUE INDEX "EmailChangeRequest_cancelHash_key" ON "EmailChangeRequest"("cancelHash");
ALTER TABLE "EmailChangeRequest" ADD CONSTRAINT "EmailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
