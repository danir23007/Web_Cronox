import { Injectable } from '@nestjs/common';
import { Mailbox } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'mailbox-nodemailer';
import {
  credential,
  resolvePublic,
  serverConfig,
  safeError,
} from './mailbox-security';

@Injectable()
export class MailboxProviderService {
  async imap(box: Mailbox) {
    serverConfig(box);
    const destination = await resolvePublic(box.imapHost);
    const client = new ImapFlow({
      host: destination.address,
      servername: box.imapHost,
      port: box.imapPort,
      secure: true,
      tls: {
        servername: box.imapHost,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
      auth: {
        user: box.username,
        pass: credential(box.imapSecretRef, box.imapSecret, `${box.id}:imap`),
      },
      logger: false,
      logRaw: false,
      disableAutoIdle: true,
      disableCompression: true,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 45000,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      return client;
    } catch (e) {
      client.close();
      throw e;
    }
  }
  async smtp(box: Mailbox) {
    serverConfig(box);
    const destination = await resolvePublic(box.smtpHost);
    return createTransport({
      host: destination.address,
      port: box.smtpPort,
      secure: box.smtpPort === 465,
      requireTLS: box.smtpPort === 587,
      tls: {
        servername: box.smtpHost,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
      auth: {
        user: box.username,
        pass: credential(box.smtpSecretRef, box.smtpSecret, `${box.id}:smtp`),
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 45000,
      logger: false,
      debug: false,
    });
  }
  async diagnose(box: Mailbox) {
    let imap = 'NOT_VERIFIED',
      smtpResult = 'NOT_VERIFIED',
      folders: { path: string; specialUse?: string }[] = [];
    try {
      const client = await this.imap(box);
      try {
        folders = (await client.list())
          .filter((f) => !f.flags.has('\\Noselect'))
          .map((f) => ({ path: f.path, specialUse: f.specialUse }));
        imap = 'TLS_AUTH_OK';
      } finally {
        await client.logout().catch(() => client.close());
      }
    } catch (e) {
      imap = safeError(e);
    }
    try {
      const smtp = await this.smtp(box);
      try {
        await smtp.verify();
        smtpResult = 'TLS_AUTH_OK';
      } finally {
        smtp.close();
      }
    } catch (e) {
      smtpResult = safeError(e);
    }
    return { imap, smtp: smtpResult, folders };
  }
}
