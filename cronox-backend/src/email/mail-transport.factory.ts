import { Injectable, Logger, Optional } from '@nestjs/common';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { loadEmailConfig } from './email.config';
import { EmailSenderKey } from './email.types';
import { PrismaService } from '../prisma/prisma.service';
import { restockDeliveryOutcome } from './restock-delivery.error';

@Injectable()
export class MailTransportFactory {
  private readonly logger = new Logger(MailTransportFactory.name);
  constructor(@Optional() private readonly db?: PrismaService) {}
  private readonly config = loadEmailConfig();
  private readonly transports = new Map<EmailSenderKey, Transporter>();

  async sendMail(senderKey: EmailSenderKey, options: SendMailOptions, purpose?: string) {
    if (!this.db) throw new Error('EMAIL_AUDIT_UNAVAILABLE');
    // No message is sent unless the attempt is durably recorded first.
    // Do not persist HTML, credentials, verification links or discount codes.
    const recipient = typeof options.to === 'string' ? options.to : '[multiple recipients]';
    const data = {
      senderKey, recipient, subject: String(options.subject || ''), purpose,
    };
    const attempt = senderKey === EmailSenderKey.NOREPLY
      ? await this.db.$transaction(async tx => {
          // All automatic No-reply purposes share one atomic account budget.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('smtp-budget:NOREPLY'))`;
          const limit = (name: string, fallback: number) => {
            const value = Number(process.env[name] || fallback);
            if (!Number.isSafeInteger(value) || value < 1) throw new Error('EMAIL_CONFIG');
            return value;
          };
          const now = Date.now();
          const hourly = await tx.emailDelivery.count({ where: { senderKey, createdAt: { gte: new Date(now - 3600_000) } } });
          const daily = await tx.emailDelivery.count({ where: { senderKey, createdAt: { gte: new Date(now - 86400_000) } } });
          if (hourly >= limit('SMTP_NOREPLY_HOURLY_LIMIT', 100) || daily >= limit('SMTP_NOREPLY_DAILY_LIMIT', 1000)) {
            throw new Error('EMAIL_RATE_LIMIT');
          }
          return tx.emailDelivery.create({ data });
        })
      : await this.db.emailDelivery.create({ data });
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
        await this.db.emailDelivery.update({ where: { id: attempt.id }, data: {
          status: known ? 'FAILED' : 'UNKNOWN', errorCode: known ? (safeCodes.includes(code) ? code : 'SMTP_REJECTED') : 'SMTP_OUTCOME_UNKNOWN',
        } });
      } catch { this.logger.error('Delivery outcome audit pending'); }
      if (!known) throw Object.assign(new Error('SMTP_OUTCOME_UNKNOWN'), { deliveryUnknown: true });
      throw error;
    }
    try {
      await this.db.emailDelivery.update({ where: { id: attempt.id }, data: {
        status: 'SMTP_ACCEPTED', providerMessageId: info.messageId,
      } });
    } catch {
      // PENDING remains visible for investigation. Do not prompt a duplicate send.
      this.logger.error('Email accepted by SMTP; delivery audit completion pending');
    }
    return info;
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
