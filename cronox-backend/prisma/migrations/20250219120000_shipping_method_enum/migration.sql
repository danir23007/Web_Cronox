-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('STANDARD', 'EXPRESS');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_shippingMethodId_fkey";

-- DropIndex
DROP INDEX "Order_shippingMethodId_idx";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "shippingMethodId",
ADD COLUMN     "shippingMethod" "ShippingMethod" NOT NULL DEFAULT 'STANDARD',
ALTER COLUMN "shippingCost" SET DATA TYPE INTEGER;

-- DropTable
DROP TABLE "ShippingMethod";

