import { MAIL_PURPOSES } from '../email/managed/mail-catalog';
import { loadEmailConfig } from '../email/email.config';
import { Injectable } from '@nestjs/common';
import MailComposer from 'mailbox-nodemailer/lib/mail-composer';
import { PrismaService } from '../prisma/prisma.service';
import { AuthSessionsService } from '../auth/auth-sessions.service';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { addresses, maxMessageBytes, safeError } from './mailbox-security';
import { assertResolved } from './mailbox-campaign-policy';
import { effectiveMailHtml } from '../email/managed/mail-renderer';

export function smtpOutcome(error: any, attempted = true) {
  if (
    !attempted ||
    ['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNREFUSED'].includes(error?.code) ||
    Number(error?.responseCode) >= 400
  )
    return 'FAILED';
  return 'UNKNOWN';
}
@Injectable()
export class MailboxSenderService {
  constructor(
    readonly db: PrismaService,
    readonly sessions: AuthSessionsService,
    readonly access: MailboxAccessService,
    readonly files: MailboxFilesService,
    readonly reader: MailboxReaderService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
  ) {}
  async recover() {
    await this.db.mailboxSend.updateMany({
      where: {
        status: 'PROCESSING',
        startedAt: { lt: new Date(Date.now() - 300000) },
        draft: {
          mailbox: {
            OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
          },
        },
      },
      data: {
        status: 'UNKNOWN',
        errorCode: 'PROCESS_INTERRUPTED_REVIEW_BEFORE_RESEND',
        completedAt: new Date(),
      },
    });
  }
  async process(id: string) {
    const pending = await this.db.mailboxSend.findUnique({
      where: { id },
      include: { draft: { include: { mailbox: true, files: true } } },
    });
    if (!pending || pending.status !== 'PENDING') return;
    return this.leases.run(pending.draft.mailboxId, async (token, assert) => {
      const claim = await this.leases.commit(
        pending.draft.mailboxId,
        token,
        (tx) =>
          tx.mailboxSend.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'PROCESSING', startedAt: new Date() },
          }),
      );
      if (!(claim as any).count) return;
      const d = pending.draft,
        b = d.mailbox;
      let rawKey: string | undefined,
        attempted = false,
        accepted = false,
        actor: any;
      try {
        if (process.env.MAILBOX_SEND_ENABLED !== 'true' || !b.active)
          throw Error('SENDING_DISABLED');
        const session = await this.sessions.validate({
          sub: pending.userId,
          sid: pending.sessionId,
          sv: pending.sessionVersion,
          type: 'access',
        });
        actor = { id: session.userId, role: session.user.role };
        await this.access.box(actor, b.id, true);
        const to = addresses(d.to, false),
          cc = addresses(d.cc).filter((v) => !to.includes(v)),
          bcc = addresses(d.bcc).filter(
            (v) => !to.includes(v) && !cc.includes(v),
          );
        const attachments: any[] = [];
        if (d.mode === 'circles') throw Error('USE_CAMPAIGN_QUEUE');
        assertResolved(d.subject, d.text, d.html || '');
        for (const f of d.files) {
          if (!f.key) throw Error('ATTACHMENT_UNAVAILABLE');
          attachments.push({
            filename: f.name,
            content: await this.files.read(f.key),
            contentType: 'application/octet-stream',
          });
        }
        if (d.templateId) {
          const template = await this.db.managedEmailTemplate.findUnique({ where: { id: d.templateId } });
          const purpose = MAIL_PURPOSES.find(p => p.key === template?.purpose);
          if (!template || template.archivedAt || (template.purpose && !purpose) ||
              (purpose && (template.senderKey !== purpose.senderKey ||
                loadEmailConfig().accounts[purpose.senderKey].user.toLowerCase() !== b.address.toLowerCase()))) {
            throw Error('MAILBOX_TEMPLATE_NOT_AVAILABLE');
          }
        }
        const composer = new MailComposer({
          from: { name: b.fromName, address: b.address },
          to,
          cc,
          bcc,
          subject: d.subject,
          text: d.text,
          html: d.html ? effectiveMailHtml(d.html) : undefined,
          messageId: pending.messageId,
          inReplyTo: d.inReplyTo || undefined,
          references: d.references,
          attachments,
          disableUrlAccess: true,
          disableFileAccess: true,
        });
        const raw = await this.files.write(
          composer.compile().createReadStream(),
          maxMessageBytes(),
        );
        rawKey = raw.key;
        const smtp = await this.provider.smtp(b);
        try {
          await assert();
          const current = await this.sessions.validate({
            sub: pending.userId,
            sid: pending.sessionId,
            sv: pending.sessionVersion,
            type: 'access',
          });
          await this.access.box(
            { id: current.userId, role: current.user.role },
            b.id,
            true,
          );
          if (
            !(await this.db.mailbox.findUniqueOrThrow({ where: { id: b.id } }))
              .active
          )
            throw Error('SENDING_DISABLED');
          attempted = true;
          const info = await smtp.sendMail({
            raw: await this.files.read(rawKey),
            envelope: { from: b.address, to: [...to, ...cc, ...bcc] },
          });
          if (!info.accepted?.length)
            throw Object.assign(Error('SMTP_REJECTED'), { code: 'EENVELOPE' });
          accepted = true;
          await this.db.mailboxSend.update({
            where: { id },
            data: {
              status: 'SMTP_ACCEPTED',
              accepted: info.accepted.map(String),
              rejected: (info.rejected || []).map(String),
              completedAt: new Date(),
              sentCopyStatus:
                b.sentCopy === 'provider' ? 'PROVIDER_MANAGED' : 'PENDING',
            },
          });
          await this.db.mailboxDraft.update({
            where: { id: d.id },
            data: { status: 'SMTP_ACCEPTED' },
          });
          await this.access.audit(actor, b.id, 'SMTP_ACCEPTED', id);
        } finally {
          smtp.close();
        }
        if (b.sentCopy !== 'provider') {
          try {
            const client = await this.provider.imap(b);
            try {
              await assert();
              const folders = await client.list(),
                sent = folders.find((f) => f.specialUse === '\\Sent');
              if (!sent) throw Error('NO_SENT_FOLDER');
              const lock = await client.getMailboxLock(sent.path);
              try {
                const matches = await client.search(
                  { header: { 'Message-ID': pending.messageId } },
                  { uid: true },
                );
                if (!matches || !matches.length) {
                  const raw = await this.reader.buffer(
                    await this.files.read(rawKey),
                    maxMessageBytes(),
                  );
                  if (!(await client.append(sent.path, raw, ['\\Seen'])))
                    throw Error('APPEND_UNSUPPORTED');
                }
              } finally {
                lock.release();
              }
              await this.db.mailboxSend.update({
                where: { id },
                data: { sentCopyStatus: 'SAVED' },
              });
              await this.db.mailbox.update({
                where: { id: b.id },
                data: { nextSyncAt: new Date() },
              });
            } finally {
              await client.logout().catch(() => client.close());
            }
          } catch {
            await this.db.mailboxSend.update({
              where: { id },
              data: { sentCopyStatus: 'FAILED_OR_UNCERTAIN' },
            });
          }
        }
      } catch (e) {
        if (!accepted) {
          const status = smtpOutcome(e, attempted);
          await this.db.mailboxSend.update({
            where: { id },
            data: {
              status,
              errorCode:
                status === 'UNKNOWN'
                  ? 'SMTP_OUTCOME_UNKNOWN_REVIEW_BEFORE_RESEND'
                  : safeError(e),
              completedAt: new Date(),
            },
          });
          await this.db.mailboxDraft.update({
            where: { id: d.id },
            data: { status },
          });
          await this.access.audit(actor || null, b.id, status, id, status);
        }
      } finally {
        if (rawKey) await this.files.remove(rawKey);
      }
    });
  }
}
