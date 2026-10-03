-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "username" TEXT NOT NULL,
    "imapSecretRef" TEXT,
    "smtpSecretRef" TEXT,
    "imapSecret" TEXT,
    "smtpSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "sentCopy" TEXT NOT NULL DEFAULT 'append',
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIG',
    "errorCode" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxPermission" (
    "mailboxId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "details" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MailboxPermission_pkey" PRIMARY KEY ("mailboxId","userId")
);

-- CreateTable
CREATE TABLE "MailboxFolder" (
    "notificationSince" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "specialUse" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "uidValidity" TEXT NOT NULL DEFAULT '',
    "lastUid" BIGINT NOT NULL DEFAULT 0,
    "importBefore" BIGINT NOT NULL DEFAULT 0,
    "reconcileUid" BIGINT NOT NULL DEFAULT 0,
    "messagesCount" INTEGER NOT NULL DEFAULT 0,
    "unseenCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxMessage" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "uid" BIGINT NOT NULL,
    "messageId" TEXT,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "preview" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "size" INTEGER NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "bodyKey" TEXT,
    "bodyState" TEXT NOT NULL DEFAULT 'NOT_LOADED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxDraft" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "to" TEXT NOT NULL DEFAULT '',
    "cc" TEXT NOT NULL DEFAULT '',
    "bcc" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxSend" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "errorCode" TEXT,
    "sentCopyStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
    "accepted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejected" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxFile" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "messageId" TEXT,
    "draftId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "key" TEXT,
    "imapPart" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxNotice" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxPushDevice" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "subscription" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mailboxIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" BOOLEAN NOT NULL DEFAULT false,
    "cursorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextPushAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxAudit" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "mailboxId" TEXT,
    "action" TEXT NOT NULL,
    "objectId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");

-- CreateIndex
CREATE INDEX "Mailbox_active_nextSyncAt_idx" ON "Mailbox"("active", "nextSyncAt");

-- CreateIndex
CREATE INDEX "MailboxPermission_userId_idx" ON "MailboxPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxFolder_mailboxId_path_key" ON "MailboxFolder"("mailboxId", "path");

-- CreateIndex
CREATE INDEX "MailboxMessage_mailboxId_alive_date_id_idx" ON "MailboxMessage"("mailboxId", "alive", "date", "id");

-- CreateIndex
CREATE INDEX "MailboxMessage_folderId_alive_seen_date_id_idx" ON "MailboxMessage"("folderId", "alive", "seen", "date", "id");

-- CreateIndex
CREATE INDEX "MailboxMessage_folderId_uidValidity_uid_idx" ON "MailboxMessage"("folderId", "uidValidity", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxMessage_folderId_uidValidity_uid_key" ON "MailboxMessage"("folderId", "uidValidity", "uid");

-- CreateIndex
CREATE INDEX "MailboxDraft_userId_mailboxId_updatedAt_idx" ON "MailboxDraft"("userId", "mailboxId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxSend_messageId_key" ON "MailboxSend"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxSend_requestKey_key" ON "MailboxSend"("requestKey");

-- CreateIndex
CREATE INDEX "MailboxSend_status_createdAt_idx" ON "MailboxSend"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxSend_draftId_draftRevision_key" ON "MailboxSend"("draftId", "draftRevision");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxFile_key_key" ON "MailboxFile"("key");

-- CreateIndex
CREATE INDEX "MailboxFile_messageId_idx" ON "MailboxFile"("messageId");

-- CreateIndex
CREATE INDEX "MailboxFile_draftId_idx" ON "MailboxFile"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxNotice_messageId_key" ON "MailboxNotice"("messageId");

-- CreateIndex
CREATE INDEX "MailboxNotice_createdAt_id_idx" ON "MailboxNotice"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxPushDevice_endpointHash_key" ON "MailboxPushDevice"("endpointHash");

-- CreateIndex
CREATE INDEX "MailboxPushDevice_active_nextPushAt_idx" ON "MailboxPushDevice"("active", "nextPushAt");

-- CreateIndex
CREATE INDEX "MailboxPushDevice_userId_sessionId_idx" ON "MailboxPushDevice"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "MailboxAudit_mailboxId_createdAt_idx" ON "MailboxAudit"("mailboxId", "createdAt");

-- AddForeignKey
ALTER TABLE "MailboxPermission" ADD CONSTRAINT "MailboxPermission_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxFolder" ADD CONSTRAINT "MailboxFolder_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MailboxFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxDraft" ADD CONSTRAINT "MailboxDraft_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxSend" ADD CONSTRAINT "MailboxSend_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "MailboxDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxFile" ADD CONSTRAINT "MailboxFile_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxFile" ADD CONSTRAINT "MailboxFile_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailboxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxFile" ADD CONSTRAINT "MailboxFile_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "MailboxDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxNotice" ADD CONSTRAINT "MailboxNotice_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxNotice" ADD CONSTRAINT "MailboxNotice_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailboxMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mail is exclusively accessed by the authenticated server, never through public Data API roles.
DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['Mailbox','MailboxPermission','MailboxFolder','MailboxMessage','MailboxDraft','MailboxSend','MailboxFile','MailboxNotice','MailboxPushDevice','MailboxAudit'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
ALTER TABLE "MailboxPermission" ADD CONSTRAINT "MailboxPermission_access_check" CHECK (access IN ('read','send'));
ALTER TABLE "MailboxSend" ADD CONSTRAINT "MailboxSend_status_check" CHECK (status IN ('PENDING','PROCESSING','SMTP_ACCEPTED','FAILED','UNKNOWN'));
ALTER TABLE "MailboxFile" ADD CONSTRAINT "MailboxFile_owner_check" CHECK (("messageId" IS NULL) <> ("draftId" IS NULL));
CREATE INDEX "MailboxMessage_subject_search_idx" ON "MailboxMessage" USING gin (subject gin_trgm_ops);
CREATE INDEX "MailboxMessage_sender_search_idx" ON "MailboxMessage" USING gin (sender gin_trgm_ops);
CREATE INDEX "MailboxMessage_recipients_search_idx" ON "MailboxMessage" USING gin (recipients gin_trgm_ops);
