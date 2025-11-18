-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "isEmailVerified";
ALTER TABLE "User" DROP COLUMN IF EXISTS "refreshTokenHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "resetTokenHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "resetTokenExp";

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "userId" TYPE INTEGER USING ("userId"::integer);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Favorite" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_productId_key" ON "Favorite"("userId", "productId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
