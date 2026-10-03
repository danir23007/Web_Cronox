import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { credential, safeError } from './mailbox-security';

const SPAN = 200;
const attachment = (node: any): boolean =>
  !!node &&
  (node.disposition === 'attachment' ||
    (node.type &&
      !['multipart', 'text', 'message'].includes(node.type.split('/')[0])) ||
    (node.childNodes || []).some(attachment));
@Injectable()
export class MailboxSyncService {
  constructor(
    readonly db: PrismaService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
  ) {}
  async sync(id: string, idle = false) {
    return this.leases.run(id, async (token, assert) => {
      const box = await this.db.mailbox.findUniqueOrThrow({ where: { id } });
      if (!box.active) return;
      try {
        credential(box.imapSecretRef, box.imapSecret, `${id}:imap`);
      } catch (error) {
        await this.leases.commit(id, token, (tx) =>
          tx.mailbox.update({
            where: { id },
            data: {
              status: 'PENDING_CONFIG',
              errorCode: safeError(error),
              nextSyncAt: new Date(Date.now() + 900000),
            },
          }),
        );
        return;
      }
      let client: any;
      try {
        client = await this.provider.imap(box);
        const folders = (await client.list()).filter(
          (f) => !f.flags.has('\\Noselect'),
        );
        await this.leases.commit(id, token, async (tx) => {
          await tx.mailboxFolder.updateMany({
            where: {
              mailboxId: id,
              path: { notIn: folders.map((f) => f.path) },
            },
            data: { available: false },
          });
          for (const f of folders)
            await tx.mailboxFolder.upsert({
              where: { mailboxId_path: { mailboxId: id, path: f.path } },
              create: { mailboxId: id, path: f.path, specialUse: f.specialUse },
              update: { available: true, specialUse: f.specialUse || null },
            });
        });
        // Round-robin folder selection: large archives cannot starve another folder.
        const selected = await this.db.mailboxFolder.findMany({
          where: { mailboxId: id, available: true },
          orderBy: { updatedAt: 'asc' },
          take: 5,
        });
        for (const cached of selected) {
          // Yield only between folders: every cursor/flag commit for the current
          // folder completes before an interactive operation can take the lease.
          if (this.leases.hasWaiting(id)) break;
          await assert();
          const lock = await client.getMailboxLock(cached.path, {
            readOnly: true,
          });
          try {
            const current = client.mailbox,
              validity = String(current.uidValidity),
              max = Math.max(0, Number(current.uidNext) - 1);
            let folder: any = cached;
            if (folder.uidValidity !== validity) {
              folder = await this.leases.commit(id, token, async (tx) => {
                await tx.mailboxMessage.updateMany({
                  where: { folderId: cached.id },
                  data: { alive: false },
                });
                return tx.mailboxFolder.update({
                  where: { id: cached.id },
                  data: {
                    uidValidity: validity,
                    lastUid: max,
                    importBefore: max,
                    reconcileUid: 0,
                    notificationSince: cached.uidValidity
                      ? new Date()
                      : box.activatedAt,
                  },
                });
              });
            }
            // Binary-search sequence positions by UID: sparse 32-bit UIDs never cause millions of empty scans.
            folder = {
              ...folder,
              lastUid: Number(folder.lastUid),
              importBefore: Number(folder.importBefore),
              reconcileUid: Number(folder.reconcileUid),
            };
            const spans: { from: number; to: number; historical: boolean }[] =
              [];
            const upperBound = async (uid: number) => {
              let low = 1,
                high = Number(current.exists) + 1;
              while (low < high) {
                const mid = Math.floor((low + high) / 2);
                const row = await client.fetchOne(String(mid), { uid: true });
                if (!row) throw Error('SEQUENCE_CHANGED_RETRY');
                if (row.uid <= uid) low = mid + 1;
                else high = mid;
              }
              return low;
            };
            if (folder.importBefore > 0) {
              const end = (await upperBound(folder.importBefore)) - 1;
              if (end > 0)
                spans.push({
                  from: Math.max(1, end - SPAN + 1),
                  to: end,
                  historical: true,
                });
              else
                await this.leases.commit(id, token, (tx) =>
                  tx.mailboxFolder.update({
                    where: { id: folder.id },
                    data: { importBefore: 0 },
                  }),
                );
            }
            if (folder.lastUid < max) {
              const start = await upperBound(folder.lastUid);
              if (start <= Number(current.exists))
                spans.push({
                  from: start,
                  to: Math.min(Number(current.exists), start + SPAN - 1),
                  historical: false,
                });
              else
                await this.leases.commit(id, token, (tx) =>
                  tx.mailboxFolder.update({
                    where: { id: folder.id },
                    data: { lastUid: max },
                  }),
                );
            }
            for (const span of spans) {
              const rows: any[] = await client.fetchAll(
                `${span.from}:${span.to}`,
                {
                  uid: true,
                  envelope: true,
                  flags: true,
                  size: true,
                  internalDate: true,
                  bodyStructure: true,
                },
              );
              await assert();
              const eligible = rows.filter(
                (row) =>
                  row.uid <= max &&
                  (span.historical
                    ? row.uid <= folder.importBefore
                    : row.uid > folder.lastUid),
              );
              await this.leases.commit(id, token, async (tx) => {
                const existing = await tx.mailboxMessage.findMany({
                  where: {
                    folderId: folder.id,
                    uidValidity: validity,
                    uid: { in: eligible.map((row) => BigInt(row.uid)) },
                  },
                  select: { uid: true },
                });
                const knownUids = new Set(existing.map((m) => String(m.uid)));
                const dataRows = eligible.map((row) => {
                  const env = row.envelope || {},
                    flags = [...row.flags] as string[],
                    parsedDate = new Date(row.internalDate || env.date || 0),
                    date = Number.isNaN(parsedDate.getTime())
                      ? new Date(0)
                      : parsedDate;
                  const identity = {
                    folderId: folder.id,
                    uidValidity: validity,
                    uid: BigInt(row.uid),
                  };
                  const data = {
                    mailboxId: id,
                    ...identity,
                    messageId: env.messageId || null,
                    subject: String(env.subject || '(Sin asunto)').slice(
                      0,
                      1000,
                    ),
                    sender: (env.from || [])
                      .map((x) => x.address || '')
                      .join(', ')
                      .slice(0, 2000),
                    recipients: [...(env.to || []), ...(env.cc || [])]
                      .map((x) => x.address || '')
                      .join(', ')
                      .slice(0, 5000),
                    envelope: JSON.parse(JSON.stringify(env)),
                    date,
                    size: Math.min(Number(row.size) || 0, 2147483647),
                    flags,
                    seen: flags.includes('\\Seen'),
                    hasAttachments: attachment(row.bodyStructure),
                    alive: true,
                  };
                  return data;
                });
                if (dataRows.length)
                  await tx.mailboxMessage.createMany({
                    data: dataRows,
                    skipDuplicates: true,
                  });
                await this.flags(tx, folder.id, validity, eligible);
                if (
                  (folder.specialUse === '\\Inbox' ||
                    folder.path.toUpperCase() === 'INBOX') &&
                  box.notify &&
                  folder.notificationSince
                ) {
                  const fresh = dataRows.filter(
                    (row) =>
                      !knownUids.has(String(row.uid)) &&
                      row.date >= folder.notificationSince,
                  );
                  if (fresh.length) {
                    const noticeMessages = await tx.mailboxMessage.findMany({
                      where: {
                        folderId: folder.id,
                        uidValidity: validity,
                        uid: { in: fresh.map((row) => row.uid) },
                      },
                      select: { id: true },
                    });
                    await tx.mailboxNotice.createMany({
                      data: noticeMessages.map((m) => ({
                        mailboxId: id,
                        messageId: m.id,
                      })),
                      skipDuplicates: true,
                    });
                  }
                }
                await tx.mailboxFolder.update({
                  where: { id: folder.id },
                  data: span.historical
                    ? {
                        importBefore: eligible.length
                          ? Math.min(...eligible.map((r) => r.uid)) - 1
                          : 0,
                      }
                    : {
                        lastUid: eligible.length
                          ? Math.max(...eligible.map((r) => r.uid))
                          : folder.lastUid,
                      },
                });
              });
            }
            const known = await this.db.mailboxMessage.findMany({
              where: {
                folderId: folder.id,
                uidValidity: validity,
                alive: true,
                uid: { gt: folder.reconcileUid },
              },
              orderBy: { uid: 'asc' },
              take: SPAN,
              select: { id: true, uid: true },
            });
            if (known.length) {
              const found: any[] = await client.fetchAll(
                known.map((m) => m.uid).join(','),
                { uid: true, flags: true },
                { uid: true },
              );
              const present = new Set(found.map((r) => String(r.uid)));
              await this.leases.commit(id, token, async (tx) => {
                await this.flags(tx, folder.id, validity, found);
                const missing = known.filter(
                  (m) => !present.has(String(m.uid)),
                );
                if (missing.length)
                  await tx.mailboxMessage.updateMany({
                    where: { id: { in: missing.map((m) => m.id) } },
                    data: { alive: false },
                  });
                await tx.mailboxFolder.update({
                  where: { id: folder.id },
                  data: {
                    reconcileUid: known.length < SPAN ? 0 : known.at(-1)!.uid,
                  },
                });
              });
            } else
              await this.leases.commit(id, token, (tx) =>
                tx.mailboxFolder.update({
                  where: { id: folder.id },
                  data: { reconcileUid: 0 },
                }),
              );
            const remoteStatus = await client.status(cached.path, {
              unseen: true,
            });
            await this.leases.commit(id, token, (tx) =>
              tx.mailboxFolder.update({
                where: { id: folder.id },
                data: {
                  messagesCount: Number(current.exists) || 0,
                  unseenCount: Number(remoteStatus?.unseen) || 0,
                },
              }),
            );
          } finally {
            lock.release();
          }
        }
        if (
          idle &&
          !this.leases.hasWaiting(id) &&
          folders.some((f) => f.path.toUpperCase() === 'INBOX') &&
          client.capabilities.has('IDLE')
        ) {
          const lock = await client.getMailboxLock('INBOX', { readOnly: true });
          let timer: ReturnType<typeof setInterval> | undefined;
          try {
            const until = Date.now() + 10000;
            timer = setInterval(() => {
              if (Date.now() >= until || this.leases.hasWaiting(id)) {
                if (timer) clearInterval(timer);
                // NOOP ends IDLE using ImapFlow's own command coordination.
                void client.noop().catch(() => client.close());
              }
            }, 200);
            await client.idle();
          } finally {
            if (timer) clearInterval(timer);
            lock.release();
          }
        }
        await this.leases.commit(id, token, (tx) =>
          tx.mailbox.update({
            where: { id },
            data: {
              status: 'CONNECTED',
              errorCode: null,
              failures: 0,
              lastSyncAt: new Date(),
              nextSyncAt: new Date(
                Date.now() + (this.leases.hasWaiting(id) ? 0 : 30000),
              ),
            },
          }),
        );
      } catch (e) {
        await this.leases
          .commit(id, token, (tx) =>
            tx.mailbox.update({
              where: { id },
              data: {
                status: 'DISCONNECTED',
                errorCode: safeError(e),
                failures: box.failures + 1,
                nextSyncAt: new Date(
                  Date.now() +
                    Math.min(900000, 15000 * 2 ** Math.min(box.failures, 6)),
                ),
              },
            }),
          )
          .catch(() => {});
        throw e;
      } finally {
        if (client) await client.logout().catch(() => client.close());
      }
    });
  }
  private async flags(
    tx: any,
    folderId: string,
    validity: string,
    rows: any[],
  ) {
    const groups = new Map<string, { flags: string[]; uids: bigint[] }>();
    for (const row of rows) {
      const flags = ([...row.flags] as string[]).sort(),
        key = JSON.stringify(flags);
      if (!groups.has(key)) groups.set(key, { flags, uids: [] });
      groups.get(key)!.uids.push(BigInt(row.uid));
    }
    for (const group of groups.values())
      await tx.mailboxMessage.updateMany({
        where: { folderId, uidValidity: validity, uid: { in: group.uids } },
        data: {
          flags: group.flags,
          seen: group.flags.includes('\\Seen'),
          alive: true,
        },
      });
  }
}
