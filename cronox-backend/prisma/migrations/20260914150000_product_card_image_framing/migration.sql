ALTER TABLE "Product"
ADD COLUMN "cardImagePositionX" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN "cardImagePositionY" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN "cardImageZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD CONSTRAINT "Product_cardImagePositionX_check" CHECK ("cardImagePositionX" BETWEEN 0 AND 100),
ADD CONSTRAINT "Product_cardImagePositionY_check" CHECK ("cardImagePositionY" BETWEEN 0 AND 100),
ADD CONSTRAINT "Product_cardImageZoom_check" CHECK ("cardImageZoom" BETWEEN 0.5 AND 3);
