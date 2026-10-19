-- CreateTable
CREATE TABLE "AccountWelcomeBenefit" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "promoCodeId" INTEGER NOT NULL,
    "welcomeJobId" TEXT NOT NULL,
    "originCheckoutId" TEXT,
    "originOrderId" INTEGER,
    "firstOnlineOrderId" INTEGER,
    "sentAt" TIMESTAMPTZ(3),
    "smtpMessageId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountWelcomeBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_userId_key" ON "AccountWelcomeBenefit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_email_key" ON "AccountWelcomeBenefit"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_promoCodeId_key" ON "AccountWelcomeBenefit"("promoCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_welcomeJobId_key" ON "AccountWelcomeBenefit"("welcomeJobId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_originCheckoutId_key" ON "AccountWelcomeBenefit"("originCheckoutId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_originOrderId_key" ON "AccountWelcomeBenefit"("originOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountWelcomeBenefit_firstOnlineOrderId_key" ON "AccountWelcomeBenefit"("firstOnlineOrderId");

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_welcomeJobId_fkey" FOREIGN KEY ("welcomeJobId") REFERENCES "NewsletterMailJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_originCheckoutId_fkey" FOREIGN KEY ("originCheckoutId") REFERENCES "CheckoutSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_originOrderId_fkey" FOREIGN KEY ("originOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_firstOnlineOrderId_fkey" FOREIGN KEY ("firstOnlineOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Private business state: no browser/API role may read or mutate eligibility.
ALTER TABLE "AccountWelcomeBenefit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AccountWelcomeBenefit" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "AccountWelcomeBenefit" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "AccountWelcomeBenefit" FROM authenticated; END IF;
END $$;
ALTER TABLE "AccountWelcomeBenefit" ADD CONSTRAINT "AccountWelcomeBenefit_acceptance_pair" CHECK (("sentAt" IS NULL) = ("smtpMessageId" IS NULL));
