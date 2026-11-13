ALTER TABLE "InventoryLot"
  ADD COLUMN "webOfferPriceCents" INTEGER,
  ADD COLUMN "webOfferPreviousCents" INTEGER,
  ADD COLUMN "webOfferStartsAt" TIMESTAMPTZ(3),
  ADD COLUMN "webOfferEndsAt" TIMESTAMPTZ(3),
  ADD COLUMN "webOfferDisabledAt" TIMESTAMPTZ(3),
  ADD COLUMN "webOfferConfirmedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "InventoryLot_web_offer_valid" CHECK (
    ("webOfferPriceCents" IS NULL AND "webOfferPreviousCents" IS NULL AND "webOfferStartsAt" IS NULL AND "webOfferEndsAt" IS NULL)
    OR ("webOfferPriceCents" IS NOT NULL AND "webOfferPreviousCents" IS NOT NULL
      AND "webOfferPriceCents" > 0 AND "webOfferPreviousCents" > "webOfferPriceCents"
      AND "webOfferStartsAt" IS NOT NULL AND "webOfferEndsAt" IS NOT NULL AND "webOfferEndsAt" > "webOfferStartsAt"
      AND "webOfferConfirmedAt" IS NOT NULL)
  );
