-- CreateTable
CREATE TABLE "EmailSenderProfile" (
    "key" TEXT NOT NULL,
    "initializedAt" TIMESTAMP(3),
    "defaultSignatureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSenderProfile_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailTemplateFolder" (
    "id" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplateFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedEmailTemplate" (
    "id" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "importKey" TEXT,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "document" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "signatureMode" TEXT NOT NULL DEFAULT 'none',
    "signatureId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailPublication" (
    "senderKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailPublication_pkey" PRIMARY KEY ("senderKey","purpose")
);

-- CreateTable
CREATE TABLE "EmailSignature" (
    "id" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAsset" (
    "id" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSenderProfile_defaultSignatureId_key" ON "EmailSenderProfile"("defaultSignatureId");

-- CreateIndex
CREATE INDEX "EmailTemplateFolder_senderKey_position_idx" ON "EmailTemplateFolder"("senderKey", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateFolder_senderKey_name_key" ON "EmailTemplateFolder"("senderKey", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateFolder_id_senderKey_key" ON "EmailTemplateFolder"("id", "senderKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedEmailTemplate_importKey_key" ON "ManagedEmailTemplate"("importKey");

-- CreateIndex
CREATE INDEX "ManagedEmailTemplate_senderKey_folderId_archivedAt_updatedA_idx" ON "ManagedEmailTemplate"("senderKey", "folderId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "ManagedEmailTemplate_senderKey_name_idx" ON "ManagedEmailTemplate"("senderKey", "name");

-- CreateIndex
CREATE INDEX "EmailTemplateVersion_templateId_createdAt_idx" ON "EmailTemplateVersion"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSignature_senderKey_archivedAt_idx" ON "EmailSignature"("senderKey", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAsset_storageKey_key" ON "EmailAsset"("storageKey");

-- CreateIndex
CREATE INDEX "EmailAsset_senderKey_createdAt_idx" ON "EmailAsset"("senderKey", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailSenderProfile" ADD CONSTRAINT "EmailSenderProfile_defaultSignatureId_fkey" FOREIGN KEY ("defaultSignatureId") REFERENCES "EmailSignature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateFolder" ADD CONSTRAINT "EmailTemplateFolder_senderKey_fkey" FOREIGN KEY ("senderKey") REFERENCES "EmailSenderProfile"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedEmailTemplate" ADD CONSTRAINT "ManagedEmailTemplate_senderKey_fkey" FOREIGN KEY ("senderKey") REFERENCES "EmailSenderProfile"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedEmailTemplate" ADD CONSTRAINT "ManagedEmailTemplate_folderId_senderKey_fkey" FOREIGN KEY ("folderId", "senderKey") REFERENCES "EmailTemplateFolder"("id", "senderKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedEmailTemplate" ADD CONSTRAINT "ManagedEmailTemplate_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "EmailSignature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateVersion" ADD CONSTRAINT "EmailTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ManagedEmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailPublication" ADD CONSTRAINT "EmailPublication_senderKey_fkey" FOREIGN KEY ("senderKey") REFERENCES "EmailSenderProfile"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailPublication" ADD CONSTRAINT "EmailPublication_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EmailTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSignature" ADD CONSTRAINT "EmailSignature_senderKey_fkey" FOREIGN KEY ("senderKey") REFERENCES "EmailSenderProfile"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAsset" ADD CONSTRAINT "EmailAsset_senderKey_fkey" FOREIGN KEY ("senderKey") REFERENCES "EmailSenderProfile"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
