-- AlterTable
ALTER TABLE "User" RENAME COLUMN "password" TO "passwordHash";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'customer');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'customer';
