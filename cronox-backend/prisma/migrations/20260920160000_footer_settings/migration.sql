CREATE TABLE "FooterSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "supportTitle" TEXT NOT NULL DEFAULT 'SOPORTE',
    "supportFaqLabel" TEXT NOT NULL DEFAULT 'FAQS',
    "supportShippingLabel" TEXT NOT NULL DEFAULT 'POLÍTICA DE ENVÍOS',
    "supportReturnsLabel" TEXT NOT NULL DEFAULT 'DEVOLUCIONES Y CAMBIOS',
    "collabTitle" TEXT NOT NULL DEFAULT 'COLABORA',
    "collabDevelopLabel" TEXT NOT NULL DEFAULT 'DESARROLLA',
    "collabEventsLabel" TEXT NOT NULL DEFAULT 'EVENTOS',
    "legalTitle" TEXT NOT NULL DEFAULT 'LEGAL',
    "legalPrivacyLabel" TEXT NOT NULL DEFAULT 'POLÍTICA DE PRIVACIDAD',
    "legalCookiesLabel" TEXT NOT NULL DEFAULT 'POLÍTICA DE COOKIES',
    "legalTermsLabel" TEXT NOT NULL DEFAULT 'TÉRMINOS DE SERVICIO',
    "legalNoticeLabel" TEXT NOT NULL DEFAULT 'AVISO LEGAL',
    "instagramUrl" TEXT NOT NULL DEFAULT 'https://www.instagram.com/cronox.es/',
    "tiktokUrl" TEXT NOT NULL DEFAULT 'https://tiktok.com/@tu_cuenta',
    "youtubeUrl" TEXT NOT NULL DEFAULT 'https://youtube.com/@tu_cuenta',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FooterSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FooterSettings_global_id_check" CHECK ("id" = 'global')
);

ALTER TABLE "FooterSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FooterSettings" FROM anon, authenticated;
