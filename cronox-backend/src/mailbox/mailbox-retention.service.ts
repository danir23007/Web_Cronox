import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { mailboxSenderKey, sentCutoff } from './mailbox-sent-policy';

export const versionFingerprint = (content: any) =>
  createHash('sha256').update(JSON.stringify(content)).digest('hex');
export async function queuePrivateKeys(
  tx: any,
  keys: (string | null | undefined)[],
) {
  for (const key of new Set(keys.filter(Boolean)))
    await tx.mailboxStorageGarbage.upsert({
      where: { key },
      create: { key },
      update: { createdAt: new Date() },
    });
}

@Injectable()
export class MailboxRetentionService {
  private cursor = '';
  private logger = new Logger(MailboxRetentionService.name);
  constructor(
    readonly db: PrismaService,
    readonly files: MailboxFilesService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
  ) {}

  async garbage() {
    for (const row of await this.db.mailboxStorageGarbage.findMany({
      where: { createdAt: { lte: new Date() } },
      take: 100,
      orderBy: { createdAt: 'asc' },
    })) {
      // Keys may be shared by a cloned draft, a cache body, or a frozen campaign.
      const refs = await this.db.$queryRaw<
        any[]
      >`SELECT 1 FROM "MailboxFile" WHERE key=${row.key}
        UNION ALL SELECT 1 FROM "MailboxMessage" WHERE "bodyKey"=${row.key}
        UNION ALL SELECT 1 FROM "MailboxCampaign" WHERE snapshot::text LIKE ${'%' + row.key + '%'}
        UNION ALL SELECT 1 FROM "MailboxCampaignVersion" WHERE content::text LIKE ${'%' + row.key + '%'} LIMIT 1`;
      if (refs.length) {
        await this.db.mailboxStorageGarbage.deleteMany({
          where: { key: row.key },
        });
        continue;
      }
      try {
        await this.files.removeStrict(row.key);
        await this.db.mailboxStorageGarbage.deleteMany({
          where: { key: row.key },
        });
      } catch {
        this.logger.warn('MAILBOX_PRIVATE_DELETE_FAILED_RETRY_PENDING');
        await this.db.mailboxStorageGarbage.update({
          where: { key: row.key },
          data: { createdAt: new Date(Date.now() + 300000) },
        });
      }
    }
  }
  async eraseAcceptedDraft(id: string, cutoff?: Date) {
    await this.db.$transaction(async (tx) => {
      const draft = await tx.mailboxDraft.findUnique({
        where: { id },
        include: { files: true, sends: true, mailbox: true },
      });
      if (
        !draft ||
        draft.status !== 'SMTP_ACCEPTED' ||
        !draft.sends.some(
          (s) =>
            s.status === 'SMTP_ACCEPTED' &&
            s.completedAt &&
            (!cutoff || s.completedAt <= cutoff),
        )
      )
        return;
      const key = mailboxSenderKey(draft.mailbox);
      if (
        !['NOREPLY', 'ORDERS', 'INFO'].includes(key || '') &&
        !(key === 'SUPPORT' && cutoff)
      )
        return;
      await queuePrivateKeys(
        tx,
        draft.files.filter((f) => !f.messageId).map((f) => f.key),
      );
      await tx.mailboxFile.deleteMany({
        where: { draftId: id, messageId: null },
      });
      await tx.mailboxDraft.update({
        where: { id },
        data: {
          subject: '',
          html: '',
          text: '',
          to: '',
          cc: '',
          bcc: '',
          references: [],
          inReplyTo: null,
          templateId: null,
        },
      });
      await tx.mailboxSend.updateMany({
        where: { draftId: id, status: 'SMTP_ACCEPTED' },
        data: { sessionId: '', sessionVersion: 0 },
      });
    });
  }
  async normalizeCampaign(id: string, simulate: boolean) {
    return this.db.$transaction(
      async (tx) => {
        const c = await tx.mailboxCampaign.findUnique({
          where: { id },
          include: { deliveries: true },
        });
        if (!c) return false;
        const legacy = c.deliveries.filter((d) => !d.versionId);
        if (!legacy.length) return true;
        // Never infer historical content from a mutable template or subject alone.
        if (
          legacy.some(
            (d) =>
              !d.content ||
              !(d.content as any).subject ||
              typeof (d.content as any).text !== 'string',
          )
        )
          return false;
        if (simulate) return true;
        for (const d of legacy) {
          const content = d.content as any;
          const version = await tx.mailboxCampaignVersion.upsert({
            where: {
              campaignId_fingerprint: {
                campaignId: id,
                fingerprint: versionFingerprint(content),
              },
            },
            create: {
              id: randomUUID(),
              campaignId: id,
              fingerprint: versionFingerprint(content),
              content,
            },
            update: {},
          });
          await tx.mailboxCampaignDelivery.update({
            where: { id: d.id },
            data: { versionId: version.id, content: Prisma.DbNull },
          });
        }
        const snapshot = c.snapshot as any;
        await tx.mailboxCampaign.update({
          where: { id },
          data: {
            snapshot: {
              ...snapshot,
              versions: (snapshot.versions || []).map(
                ({ subject, html, text, ...v }: any) => v,
              ),
            },
          },
        });
        return true;
      },
      { timeout: 60000 },
    );
  }
  async removeLocalMessage(id: string) {
    await this.db.$transaction(async (tx) => {
      const m = await tx.mailboxMessage.findUnique({
        where: { id },
        include: { files: true },
      });
      if (!m) return;
      await queuePrivateKeys(tx, [
        m.bodyKey,
        ...m.files.filter((f) => !f.draftId).map((f) => f.key),
      ]);
      // A file referenced by a live draft is detached, never cascaded away.
      await tx.mailboxFile.updateMany({
        where: { messageId: id, draftId: { not: null } },
        data: { messageId: null },
      });
      await tx.mailboxMessage.delete({ where: { id } });
    });
  }
  async cleanBox(
    id: string,
    simulate = true,
    now = new Date(),
    afterUid?: number,
  ) {
    return this.leases.run(id, async (_token, assert) => {
      const box = await this.db.mailbox.findUniqueOrThrow({ where: { id } });
      const key = mailboxSenderKey(box),
        cutoff = sentCutoff(now);
      const report = {
        mailboxId: id,
        senderKey: key,
        simulate,
        local: 0,
        provider: 0,
        drafts: 0,
        normalizedCampaigns: 0,
        unresolved: [] as string[],
        more: false,
        folders: [] as { path: string; scanned: number; nextUid: number }[],
      };
      if (!key) return report;
      const campaigns =
        key === 'INFO'
          ? await this.db.mailboxCampaign.findMany({
              where: {
                draft: { mailboxId: id },
                deliveries: { some: { versionId: null } },
              },
              take: 50,
            })
          : [];
      for (const c of campaigns) {
        if (await this.normalizeCampaign(c.id, simulate))
          report.normalizedCampaigns++;
        else report.unresolved.push('campaign:' + c.id);
      }
      const safeInfo = async (messageId: string | null) => {
        if (!messageId) return false;
        const d = await this.db.mailboxCampaignDelivery.findUnique({
          where: { messageId },
          include: { campaign: { include: { draft: true } } },
        });
        return (
          !!d &&
          d.campaign.draft.mailboxId === id &&
          !!(
            d.versionId ||
            (await this.normalizeCampaign(d.campaignId, simulate))
          )
        );
      };
      // Confirm the provider's real special-use folder. Do not rely on display labels.
      const client = await this.provider.imap(box);
      try {
        const sentFolders = (await client.list()).filter(
          (f) => f.specialUse === '\\Sent' && !f.flags?.has('\\Noselect'),
        );
        if (!sentFolders.length) {
          report.unresolved.push('NO_CONFIRMED_SENT_FOLDER');
          return report;
        }
        for (const folder of sentFolders) {
          await assert();
          const lock = await client.getMailboxLock(folder.path, {
            readOnly: simulate,
          });
          try {
            if (!client.mailbox) throw Error('RETENTION_NO_SELECTED_FOLDER');
            const validity = String(client.mailbox.uidValidity);
            const cached = await this.db.mailboxFolder.findUnique({
              where: { mailboxId_path: { mailboxId: id, path: folder.path } },
            });
            const safeIds =
              cached && key === 'INFO'
                ? await this.db.$queryRaw<
                    { id: string }[]
                  >`SELECT m.id FROM "MailboxMessage" m WHERE m."folderId"=${cached.id} AND EXISTS (SELECT 1 FROM "MailboxCampaignDelivery" d JOIN "MailboxCampaign" c ON c.id=d."campaignId" JOIN "MailboxDraft" dr ON dr.id=c."draftId" WHERE d."messageId"=m."messageId" AND dr."mailboxId"=${id} AND (d."versionId" IS NOT NULL OR d.content IS NOT NULL)) LIMIT 100`
                : null;
            if (cached && key === 'INFO') {
              const unresolved = await this.db.$queryRaw<
                { id: string }[]
              >`SELECT m.id FROM "MailboxMessage" m WHERE m."folderId"=${cached.id} AND NOT EXISTS (SELECT 1 FROM "MailboxCampaignDelivery" d JOIN "MailboxCampaign" c ON c.id=d."campaignId" JOIN "MailboxDraft" dr ON dr.id=c."draftId" WHERE d."messageId"=m."messageId" AND dr."mailboxId"=${id} AND (d."versionId" IS NOT NULL OR d.content IS NOT NULL)) LIMIT 100`;
              report.unresolved.push(
                ...unresolved.map((m) => 'message:' + m.id),
              );
            }
            const local = cached
              ? await this.db.mailboxMessage.findMany({
                  where: {
                    folderId: cached.id,
                    ...(safeIds
                      ? { id: { in: safeIds.map((v) => v.id) } }
                      : {}),
                    ...(key === 'SUPPORT' ? { date: { lte: cutoff } } : {}),
                  },
                  take: 100,
                  orderBy: { id: 'asc' },
                })
              : [];
            for (const m of local) {
              if (key === 'INFO' && !(await safeInfo(m.messageId))) {
                report.unresolved.push('message:' + m.id);
                continue;
              }
              report.local++;
              if (!simulate) await this.removeLocalMessage(m.id);
            }
            // One bounded batch by sequence; messages that cannot be associated stay intact.
            // The caller uses the report/cursor to review and process subsequent batches.
            const cursor =
              afterUid ??
              (cached?.uidValidity === validity
                ? Number(cached.retentionUid)
                : 0);
            const allUids: number[] =
              (await client.search({ all: true }, { uid: true })) || [];
            const batch = allUids
              .filter((uid) => uid > cursor)
              .sort((a, b) => a - b)
              .slice(0, 100);
            const rows = batch.length
              ? await client.fetchAll(
                  batch.join(','),
                  { uid: true, envelope: true, internalDate: true },
                  { uid: true },
                )
              : [];
            report.folders.push({
              path: folder.path,
              scanned: rows.length,
              nextUid: batch.at(-1) || 0,
            });
            const uids: number[] = [];
            for (const row of rows) {
              const sentAt = new Date(
                row.envelope?.date || row.internalDate || 0,
              );
              if (
                key === 'SUPPORT' &&
                (!Number.isFinite(sentAt.getTime()) ||
                  sentAt.getTime() <= 0 ||
                  sentAt > cutoff)
              )
                continue;
              if (
                key === 'INFO' &&
                !(await safeInfo(row.envelope?.messageId || null))
              ) {
                report.unresolved.push(
                  'provider:' + folder.path + ':' + row.uid,
                );
                continue;
              }
              uids.push(row.uid);
            }
            report.provider += uids.length;
            report.more ||=
              allUids.some((uid) => uid > (batch.at(-1) || cursor)) ||
              local.length === 100;
            if (!simulate && uids.length) {
              // Without UIDPLUS messageDelete may expunge other clients' deleted messages.
              if (!client.capabilities?.has('UIDPLUS'))
                throw Error('RETENTION_UIDPLUS_REQUIRED');
              await assert();
              if (
                !client.mailbox ||
                String(client.mailbox.uidValidity) !== validity
              )
                throw Error('RETENTION_UIDVALIDITY_CHANGED');
              if (!(await client.messageDelete(uids.join(','), { uid: true })))
                throw Error('RETENTION_DELETE_FAILED');
              if (cached) {
                const deletedCopies = await this.db.mailboxMessage.findMany({
                  where: {
                    folderId: cached.id,
                    uidValidity: validity,
                    uid: { in: uids.map((uid) => BigInt(uid)) },
                  },
                  select: { id: true },
                });
                for (const copy of deletedCopies)
                  await this.removeLocalMessage(copy.id);
              }
            }
            if (!simulate && cached)
              await this.db.mailboxFolder.update({
                where: { id: cached.id },
                data: {
                  retentionUid: report.more && batch.length ? batch.at(-1)! : 0,
                },
              });
          } finally {
            lock.release();
          }
        }
      } finally {
        await client.logout().catch(() => client.close());
      }
      const drafts = await this.db.mailboxDraft.findMany({
        where: {
          mailboxId: id,
          status: 'SMTP_ACCEPTED',
          OR: [
            { text: { not: '' } },
            { html: { not: '' } },
            { files: { some: {} } },
          ],
          sends: {
            some: {
              status: 'SMTP_ACCEPTED',
              ...(key === 'SUPPORT' ? { completedAt: { lte: cutoff } } : {}),
            },
          },
        },
        take: 100,
        select: { id: true },
      });
      report.drafts = drafts.length;
      if (!simulate)
        for (const d of drafts)
          await this.eraseAcceptedDraft(
            d.id,
            key === 'SUPPORT' ? cutoff : undefined,
          );
      return report;
    });
  }
  async tick() {
    await this.garbage();
    const boxesWithContent = await this.db.mailbox.findMany({
      where: { drafts: { some: { status: 'SMTP_ACCEPTED' } } },
    });
    for (const box of boxesWithContent) {
      if (!['NOREPLY', 'ORDERS', 'INFO'].includes(mailboxSenderKey(box) || ''))
        continue;
      const drafts = await this.db.mailboxDraft.findMany({
        where: {
          mailboxId: box.id,
          status: 'SMTP_ACCEPTED',
          OR: [
            { text: { not: '' } },
            { html: { not: '' } },
            { files: { some: {} } },
          ],
        },
        take: 100,
        select: { id: true },
      });
      for (const d of drafts) await this.eraseAcceptedDraft(d.id);
    }
    // No destructive IMAP work is activated implicitly by deploying this code.
    if (process.env.MAILBOX_SENT_RETENTION_ENABLED !== 'true') return;
    const boxes = await this.db.mailbox.findMany({
      where: { active: true, id: { gt: this.cursor } },
      orderBy: { id: 'asc' },
      take: 1,
    });
    if (!boxes.length) {
      this.cursor = '';
      return;
    }
    this.cursor = boxes[0].id;
    await this.cleanBox(boxes[0].id, false);
  }
}
