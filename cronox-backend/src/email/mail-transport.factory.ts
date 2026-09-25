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
    const attempt = await this.db.emailDelivery.create({ data: {
      senderKey, recipient, subject: String(options.subject || ''), purpose,
    } });
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
      const known = restockDeliveryOutcome(error) !== 'UNCERTAIN' || safeCodes.includes(code);
      try {
        await this.db.emailDelivery.update({ where: { id: attempt.id }, data: {
          status: known ? 'FAILED' : 'UNKNOWN', errorCode: known ? (safeCodes.includes(code) ? code : 'SMTP_REJECTED') : 'SMTP_OUTCOME_UNKNOWN',
        } });
      } catch { this.logger.error('Delivery outcome audit pending'); }
      if (!known && error instanceof Error) Object.assign(error, { deliveryUnknown: true });
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
