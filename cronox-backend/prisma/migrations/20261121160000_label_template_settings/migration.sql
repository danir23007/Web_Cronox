CREATE TABLE "LabelTemplateSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "definition" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedBy" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LabelTemplateSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LabelTemplateSettings_global_check" CHECK ("id" = 'global'),
  CONSTRAINT "LabelTemplateSettings_revision_check" CHECK ("revision" >= 0)
);
