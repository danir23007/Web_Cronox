import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import MailComposer from 'nodemailer/lib/mail-composer';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { loadEmailConfig } from './email.config';
import { EmailSenderKey } from './email.types';
import { PrismaService } from '../prisma/prisma.service';
import { restockDeliveryOutcome } from './restock-delivery.error';
import { EmailQuotaWaitError, quotaAttemptId, quotaWaiting, recipientUnits, reserveAccountQuota } from './mail-account-quota';
import { decrypt, encrypt, maxMessageBytes, maxAttachmentBytes } from '../mailbox/mailbox-security';

@Injectable()
export class MailTransportFactory implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(MailTransportFactory.name);
  constructor(@Optional() private readonly db?: PrismaService) {}
  private readonly config = loadEmailConfig();
  private readonly transports = new Map<EmailSenderKey, Transporter>();

  async sendMail(senderKey: EmailSenderKey, options: SendMailOptions, purpose?: string): Promise<{ messageId: string; accepted?: unknown[]; queued?: boolean }> {
    if (!this.db) throw new Error('EMAIL_AUDIT_UNAVAILABLE');
    if (options.raw || options.envelope) throw Error('EMAIL_RAW_INPUT_UNSUPPORTED');
    // No message is sent unless the attempt is durably recorded first.
    // Do not persist HTML, credentials, verification links or discount codes.
    const recipient = typeof options.to === 'string' ? options.to : '[multiple recipients]';
    const { units } = recipientUnits(options);
    let totalAttachments = 0;
    for (const attachment of options.attachments || []) {
      if (attachment.path || (attachment as { href?: string }).href || !attachment.content ||
          !(typeof attachment.content === 'string' || Buffer.isBuffer(attachment.content))) throw Error('EMAIL_ATTACHMENT_UNSUPPORTED');
      totalAttachments += Buffer.isBuffer(attachment.content) ? attachment.content.length :
        Buffer.byteLength(attachment.content, attachment.encoding as BufferEncoding || 'utf8');
    }
    if (totalAttachments > maxAttachmentBytes()) throw Error('EMAIL_ATTACHMENT_LIMIT');
    const compiled = new MailComposer({ ...options, from: this.getFrom(senderKey), disableFileAccess: true, disableUrlAccess: true }).compile();
    const raw = await new Promise<Buffer>((resolve, reject) => compiled.build((error, content) => error ? reject(error) : resolve(content)));
    if (raw.length > maxMessageBytes()) throw Error('EMAIL_MESSAGE_LIMIT');
    const prepared = { raw, envelope: compiled.getEnvelope() };
    const data = { id: quotaAttemptId(), senderKey, recipient, subject: String(options.subject || ''), purpose, quotaUnits: units };
    let attempt;
    try {
      attempt = await this.db.$transaction(async tx => {
        if (process.env.EMAIL_SMTP_PAUSED === 'true') throw new EmailQuotaWaitError(new Date(Date.now() + 60000));
        await reserveAccountQuota(tx, this.config.accounts[senderKey].user, 'AUTO:' + data.id, units);
        return tx.emailDelivery.create({ data });
      });
    } catch (error) {
      if (!quotaWaiting(error) || !['ORDER_CONFIRMATION','ORDER_SHIPPED','ORDER_DELIVERED'].includes(purpose || '')) throw error;
      // Existing newsletter/restock jobs wait in their own durable queues. Orders
      // need this outbox so a committed payment/status change never loses mail.
      const payload = encrypt(JSON.stringify({ raw: raw.toString('base64'), envelope: prepared.envelope }), data.id + ':queued-email');
      await this.db.emailDelivery.create({ data: { ...data, status: 'WAITING_QUOTA', pendingPayload: payload, readyAt: error.retryAt } });
      return { messageId: data.id, queued: true }; // not an SMTP acceptance
    }
    return this.deliverAttempt(attempt.id, senderKey, prepared);
  }
  private async deliverAttempt(id: string, senderKey: EmailSenderKey, options: SendMailOptions) {
    if (!this.db) throw Error('EMAIL_AUDIT_UNAVAILABLE');
    let info: { messageId: string; accepted?: unknown[] };
    try {
      let transport: Transporter;
      let from: string;
      try { transport = this.getTransport(senderKey); from = this.getFrom(senderKey); }
      catch (error) { throw Object.assign(error as Error, { code: 'EMAIL_CONFIG' }); }
      info = await transport.sendMail({ ...options, from });
      if (!info.accepted?.length) throw Object.assign(new Error('SMTP_RECIPIENT_NOT_ACCEPTED'), { code: 'EENVELOPE' });
    } catch (error) {
      const code = String((error as { code?: string }).code || 'SMTP_OUTCOME_UNKNOWN');
      const safeCodes = ['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EDNS', 'ECONNREFUSED', 'EMAIL_CONFIG'];
      const smtp = error as { command?: string; accepted?: unknown[] };
      // A connection loss during DATA/QUIT does not prove rejection. Never undo
      // an initial password or retry when the server may have accepted the mail.
      const beforeDelivery = code === 'EMAIL_CONFIG' ||
        (['EAUTH', 'EENVELOPE'].includes(code) &&
          (!smtp.command || /^(API|AUTH(?: .*?)?|MAIL FROM|RCPT TO)$/.test(smtp.command)));
      const ambiguousConnection = code === 'ECONNECTION' &&
        (!smtp.command || ['CONN', 'API', 'QUIT'].includes(smtp.command));
      const known = !smtp.accepted?.length && !ambiguousConnection &&
        (restockDeliveryOutcome(error) !== 'UNCERTAIN' || beforeDelivery);
      try {
        await this.db.emailDelivery.update({ where: { id }, data: {
          status: known ? 'FAILED' : 'UNKNOWN', errorCode: known ? (safeCodes.includes(code) ? code : 'SMTP_REJECTED') : 'SMTP_OUTCOME_UNKNOWN',
          pendingPayload: null, readyAt: null,
        } });
      } catch { this.logger.error('Delivery outcome audit pending'); }
      if (!known) throw Object.assign(new Error('SMTP_OUTCOME_UNKNOWN'), { deliveryUnknown: true });
      throw error;
    }
    try {
      await this.db.emailDelivery.update({ where: { id }, data: {
        status: 'SMTP_ACCEPTED', providerMessageId: info.messageId,
        pendingPayload: null, readyAt: null,
      } });
    } catch {
      // PENDING remains visible for investigation. Do not prompt a duplicate send.
      this.logger.error('Email accepted by SMTP; delivery audit completion pending');
    }
    return info;
  }

  onModuleInit() {
    if (!this.db || !this.config.enabled || process.env.MAILBOX_WORKER_ENABLED !== 'true' ||
        process.env.EMAIL_SMTP_PAUSED === 'true' || process.env.BACKGROUND_JOBS_ENABLED === 'false' || process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') return;
    this.timer = setInterval(() => void this.tickDeferred().catch(() => this.logger.error('EMAIL_DEFERRED_WORKER_FAILED')), 10000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise(resolve => setTimeout(resolve, 100));
    for (const transport of this.transports.values()) transport.close();
  }
  async tickDeferred() {
    if (!this.db || this.running || this.stopped || process.env.EMAIL_SMTP_PAUSED === 'true') return;
    this.running = true;
    try {
      await this.db.emailDelivery.updateMany({ where: { status: 'QUEUE_PROCESSING', readyAt: { lt: new Date(Date.now()-300000) } },
        data: { status: 'UNKNOWN', errorCode: 'PROCESS_INTERRUPTED_REVIEW_BEFORE_RESEND', pendingPayload: null, readyAt: null } });
      const jobs = await this.db.emailDelivery.findMany({ where: { status: 'WAITING_QUOTA', readyAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 2 });
      for (const job of jobs) {
        const key = job.senderKey as EmailSenderKey;
        if (!Object.values(EmailSenderKey).includes(key) || !job.pendingPayload) throw Error('EMAIL_DEFERRED_INVALID_JOB');
        let payload;
        try { payload = JSON.parse(decrypt(job.pendingPayload, job.id + ':queued-email')); }
        catch { this.logger.error('EMAIL_DEFERRED_KEY_UNAVAILABLE'); continue; }
        if (Buffer.from(payload.raw || '', 'base64').length > maxMessageBytes() ||
            recipientUnits({ to: payload.envelope?.to }).units !== job.quotaUnits) {
          await this.db.emailDelivery.updateMany({ where: { id: job.id, status: 'WAITING_QUOTA' }, data: { errorCode: 'EMAIL_DEFERRED_LIMIT_REVIEW' } });
          continue;
        }
        if (String(payload.envelope?.from).toLowerCase() !== this.config.accounts[key].user.toLowerCase()) {
          await this.db.emailDelivery.updateMany({ where: { id: job.id, status: 'WAITING_QUOTA' }, data: { errorCode: 'EMAIL_ACCOUNT_CHANGED_REVIEW' } });
          continue;
        }
        let claimed;
        try {
          claimed = await this.db.$transaction(async tx => {
            const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "EmailDelivery" WHERE id=${job.id} AND status='WAITING_QUOTA' FOR UPDATE`;
            if (!rows.length || process.env.EMAIL_SMTP_PAUSED === 'true') return false;
            await reserveAccountQuota(tx, this.config.accounts[key].user, 'AUTO:' + job.id, job.quotaUnits);
            await tx.emailDelivery.update({ where: { id: job.id }, data: { status: 'QUEUE_PROCESSING', readyAt: new Date(), errorCode: null } });
            return true;
          });
        } catch (error) {
          if (!quotaWaiting(error)) throw error;
          await this.db.emailDelivery.updateMany({ where: { id: job.id, status: 'WAITING_QUOTA' }, data: { readyAt: error.retryAt } });
          continue;
        }
        if (claimed) await this.deliverAttempt(job.id, key, { raw: Buffer.from(payload.raw,'base64'), envelope: payload.envelope }).catch(() => this.logger.warn('EMAIL_DEFERRED_DELIVERY_RECORDED'));
      }
    } finally { this.running = false; }
  }

  getTransport(senderKey: EmailSenderKey): Transporter {
    if (!this.config.enabled) {
      throw new Error('[EmailTransport] Email delivery is disabled.');
    }

    const cached = this.transports.get(senderKey);
    if (cached) {
      return cached;
    }

    const account = this.config.accounts[senderKey];
    if (!account?.user || !account?.pass) {
      throw new Error(
        `[EmailTransport] Cuenta SMTP no configurada para ${senderKey}. Revisa las variables SMTP_* de este buzón.`,
      );
    }

    const options: SMTPTransport.Options = {
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    };

    const transport = createTransport(options);
    this.transports.set(senderKey, transport);
    return transport;
  }

  getFrom(senderKey: EmailSenderKey): string {
    if (!this.config.enabled) {
      throw new Error('[EmailTransport] Email delivery is disabled.');
    }

    const account = this.config.accounts[senderKey];
    const fromName = account?.fromName || this.config.defaultFromName;

    if (!account?.user) {
      throw new Error(
        `[EmailTransport] Remitente no configurado para ${senderKey}. Revisa SMTP_*_USER de este buzón.`,
      );
    }

    return `"${fromName}" <${account.user}>`;
  }
}
