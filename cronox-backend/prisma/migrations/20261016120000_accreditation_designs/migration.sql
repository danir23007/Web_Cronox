BEGIN;
CREATE TABLE "AccreditationDesign" (
  "id" TEXT PRIMARY KEY,
  "name" VARCHAR(100) NOT NULL,
  "renderer" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AccreditationSelection" (
  "id" TEXT PRIMARY KEY DEFAULT 'global' CHECK ("id" = 'global'),
  "activeDesignId" TEXT NOT NULL REFERENCES "AccreditationDesign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "AccreditationDesign" ("id", "name", "renderer", "config") VALUES (
  'original', 'Acreditación original', 'original-v1',
  '{"version":1,"artworkUrl":"https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/Acreditation/Libro-antiguo.png"}'
);
INSERT INTO "AccreditationSelection" ("id", "activeDesignId") VALUES ('global', 'original');
COMMIT;
