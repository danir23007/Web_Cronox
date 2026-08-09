import { Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { loadEmailConfig } from './email.config';
import { EmailSenderKey } from './email.types';

@Injectable()
export class MailTransportFactory {
  private readonly config = loadEmailConfig();
  private readonly transports = new Map<EmailSenderKey, Transporter>();

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
