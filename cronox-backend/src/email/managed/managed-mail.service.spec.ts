import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailTransportFactory } from '../mail-transport.factory';
import { EmailSenderKey, EmailType, EmailConfig } from '../email.types';
import { EmailService } from '../email.service';
import * as config from '../email.config';
import { ManagedMailService } from './managed-mail.service';
import { MAIL_PURPOSES } from './mail-catalog';
import { MailSaveDto } from './mail.dto';

const emailConfig: EmailConfig = {
  enabled: true,
  smtpHost: 'smtp.example.test',
  smtpPort: 465,
  smtpSecure: true,
  defaultFromName: 'CRONOX',
  accounts: Object.fromEntries(
    Object.values(EmailSenderKey).map((key) => [
      key,
      {
        user: `${key.toLowerCase()}@example.test`,
        pass: 'SERVER_ONLY_PASSWORD',
        fromName: 'CRONOX',
      },
    ]),
  ) as EmailConfig['accounts'],
};
const transport = () => ({
  getTransport: jest.fn(),
  getFrom: jest.fn().mockReturnValue('CRONOX <test@example.test>'),
});
describe('managed email safety and import', () => {
  beforeEach(() =>
    jest.spyOn(config, 'loadEmailConfig').mockReturnValue(emailConfig),
  );
  afterEach(() => jest.restoreAllMocks());
  it('describes every offered variable in Spanish instead of exposing only its technical key', () => {
    const service = new ManagedMailService(
      {} as PrismaService,
      transport() as unknown as MailTransportFactory,
    );
    for (const purpose of service.catalog()) {
      for (const variable of purpose.variables) {
        expect(variable.description).not.toBe(variable.key);
      }
    }
  });
  it('exposes only sender metadata, including safely unconfigured accounts', () => {
    const service = new ManagedMailService(
      {} as PrismaService,
      transport() as unknown as MailTransportFactory,
    );
    const result = service.metadata();
    expect(result).toHaveLength(4);
    expect(JSON.stringify(result)).not.toMatch(
      /SERVER_ONLY_PASSWORD|smtpHost|smtpPort|pass|auth/,
    );
    expect(result[0]).toEqual({
      key: 'SUPPORT',
      email: 'support@example.test',
      name: 'CRONOX',
      configured: true,
    });
    jest
      .spyOn(config, 'loadEmailConfig')
      .mockReturnValue({ ...emailConfig, enabled: false });
    expect(service.metadata().every((a) => !a.configured)).toBe(true);
  });
  it('imports all ten actual purposes, 5 independent copies each, exactly once', async () => {
    const profiles = new Map<
      string,
      { key: string; initializedAt: Date | null }
    >();
    const folderRows = new Map<string, { id: string }>();
    const templateRows = new Map<string, Record<string, unknown>>();
    const db = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(),
      auditLog: { create: jest.fn() },
      emailSenderProfile: {
        upsert: jest.fn(({ where }: { where: { key: string } }) => {
          if (!profiles.has(where.key))
            profiles.set(where.key, { key: where.key, initializedAt: null });
          return profiles.get(where.key);
        }),
        update: jest.fn(({ where }: { where: { key: string } }) => {
          const row = profiles.get(where.key)!;
          row.initializedAt = new Date();
          return row;
        }),
      },
      emailTemplateFolder: {
        upsert: jest.fn(
          ({
            where,
          }: {
            where: { senderKey_name: { senderKey: string; name: string } };
          }) => {
            const k = JSON.stringify(where);
            if (!folderRows.has(k)) folderRows.set(k, { id: k });
            return folderRows.get(k);
          },
        ),
      },
      managedEmailTemplate: {
        count: jest.fn(
          ({ where }: { where: { importKey: { in: string[] } } }) =>
            where.importKey.in.filter((key) => templateRows.has(key)).length,
        ),
        upsert: jest.fn(
          ({
            where,
            create,
          }: {
            where: { importKey: string };
            create: Record<string, unknown>;
          }) => {
            if (!templateRows.has(where.importKey))
              templateRows.set(where.importKey, {
                ...create,
                id: where.importKey,
              });
            return templateRows.get(where.importKey);
          },
        ),
      },
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport() as unknown as MailTransportFactory,
    );
    for (const key of Object.values(EmailSenderKey)) {
      await service.initialize(key, 1);
      await service.initialize(key, 1);
    }
    expect(profiles.size).toBe(4);
    expect(folderRows.size).toBe(20);
    expect(templateRows.size).toBe(55);
    for (const p of MAIL_PURPOSES) {
      const copies = [...templateRows.values()].filter(
        (t) => t.purpose === p.key,
      );
      expect(copies).toHaveLength(5);
      expect(
        copies.every((t) => t.senderKey === p.senderKey && t.name === p.name),
      ).toBe(true);
      expect(
        copies.every(
          (t) =>
            (t.document as { sourceKind?: string }).sourceKind ===
            'cronox-first-party',
        ),
      ).toBe(true);
    }
    const copies = [...templateRows.values()].filter(
      (t) => t.purpose === 'PASSWORD_RESET',
    );
    copies[0].subject = 'Cambio independiente';
    expect(copies[1].subject).not.toBe('Cambio independiente');
  });
  it('rejects cross-account templates and optimistic concurrency conflicts', async () => {
    const db = {
      managedEmailTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      emailTemplateFolder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'folder' }),
      },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport() as unknown as MailTransportFactory,
    );
    await expect(service.template('INFO', 'foreign')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.managedEmailTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', senderKey: 'INFO' },
    });
    db.managedEmailTemplate.findFirst.mockResolvedValue({ revision: 2 });
    await expect(
      service.save(
        EmailSenderKey.INFO,
        {
          name: 'Prueba',
          subject: 'Asunto',
          folderId: 'folder',
          document: { blocks: [] },
          revision: 1,
        } as MailSaveDto,
        1,
        't',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.save(EmailSenderKey.INFO, {
        name: 'Prueba',
        subject: 'Asunto',
        purpose: 'PASSWORD_RESET',
      } as MailSaveDto),
    ).rejects.toThrow('Propósito incompatible');
  });
  it('adapts a persisted first-party HTML draft on read without mutating storage', async () => {
    const update = jest.fn();
    const db = {
      managedEmailTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'confirmation',
          senderKey: 'ORDERS',
          purpose: 'ORDER_CONFIRMATION',
          document: {
            blocks: [
              { type: 'html', html: '{{#each items}}{{name}}{{/each}}' },
            ],
          },
        }),
        update,
      },
    };
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport() as unknown as MailTransportFactory,
    );

    const result = await service.template('ORDERS', 'confirmation');

    expect(result.document).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        sourceKind: 'cronox-first-party',
      }),
    );
    const editableBlocks = (result.document as { blocks: unknown[] }).blocks;
    expect(JSON.stringify(editableBlocks)).toContain('orderItems');
    expect(JSON.stringify(editableBlocks)).not.toContain('"type":"html"');
    expect(update).not.toHaveBeenCalled();
  });
  it('blocks incomplete and foreign folder reorders and non-empty deletion', async () => {
    const db = {
      $transaction: jest.fn(),
      emailTemplateFolder: {
        findMany: jest.fn().mockResolvedValue([{ id: 'own' }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'own' }),
      },
      managedEmailTemplate: { count: jest.fn().mockResolvedValue(1) },
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport() as unknown as MailTransportFactory,
    );
    await expect(
      service.reorder(EmailSenderKey.INFO, ['foreign'], 1),
    ).rejects.toThrow('Orden');
    await expect(
      service.deleteFolder(EmailSenderKey.INFO, 'own', { mode: 'empty' }, 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('falls back before SMTP on database/render failure, and never retries an SMTP failure', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'mock-1' });
    const factory = transport();
    factory.getTransport.mockReturnValue({ sendMail });
    const managed = {
      published: jest.fn().mockRejectedValue(new Error('DB unavailable')),
    };
    const service = new EmailService(
      factory as unknown as MailTransportFactory,
      managed as unknown as ManagedMailService,
    );
    await expect(
      service.send({
        type: EmailType.TEST,
        to: 'test@example.test',
        subject: 'Prueba',
        templateData: { message: 'Hola' },
      }),
    ).resolves.toEqual({ messageId: 'mock-1' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Prueba',
      }),
    );
    managed.published.mockResolvedValue({
      html: '<p>Publicada</p>',
      text: 'Publicada',
      subject: 'Asunto publicado',
    });
    sendMail.mockRejectedValue(new Error('SMTP failure'));
    await expect(
      service.send({
        type: EmailType.TEST,
        to: 'test@example.test',
        subject: 'Prueba',
      }),
    ).rejects.toThrow();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
