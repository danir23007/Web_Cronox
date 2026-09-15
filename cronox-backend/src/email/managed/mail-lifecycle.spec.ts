import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/roles.decorator';
import { ManagedMailController } from './managed-mail.controller';
import { ManagedMailService } from './managed-mail.service';
import { MailTransportFactory } from '../mail-transport.factory';
import { EmailSenderKey } from '../email.types';
import {
  MailActionDto,
  MailMultiSaveDto,
  MailSaveDto,
  TestMailDto,
} from './mail.dto';

const template = {
  id: 't',
  senderKey: 'INFO',
  folderId: 'f',
  name: 'Genérico',
  subject: '{{subject}}',
  preheader: 'Avance',
  purpose: 'GENERIC',
  document: { blocks: [{ type: 'text', text: 'Original {{message}}' }] },
  signatureMode: 'none',
  signatureId: null,
  revision: 1,
  archivedAt: null,
};
describe('email permissions, publication and controlled tests', () => {
  it('requires authentication and super-admin roles on the entire controller', () => {
    const reflector = new Reflector();
    expect(reflector.get(GUARDS_METADATA, ManagedMailController)).toEqual([
      JwtAuthGuard,
      AdminGuard,
      RolesGuard,
    ]);
    expect(reflector.get(ROLES_KEY, ManagedMailController)).toEqual([
      Role.SUPERADMIN,
    ]);
    expect(
      reflector.get(
        'THROTTLER:LIMITdefault',
        Object.getOwnPropertyDescriptor(ManagedMailController.prototype, 'test')
          ?.value as (...args: unknown[]) => unknown,
      ),
    ).toBe(3);
  });
  it('validates recipient, explicit confirmation type, action and document payloads', async () => {
    expect(
      await validate(
        plainToInstance(TestMailDto, { to: 'not-email', confirmed: 'true' }),
      ),
    ).toHaveLength(2);
    expect(
      (
        await validate(
          plainToInstance(MailActionDto, {
            action: 'delete-everything',
            revision: 0,
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(MailSaveDto, {
            name: 'n',
            subject: 's',
            folderId: 'f',
            document: '<html>',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(MailMultiSaveDto, {
            name: 'n',
            subject: 's',
            folderId: 'f',
            document: { blocks: [] },
            targets: [{ id: 't', revision: 0 }],
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('publishes an immutable snapshot, keeps subsequent draft edits isolated, and resolves default signatures freshly', async () => {
    let snapshot: unknown,
      signatureText = 'Firma inicial';
    const db = {
      $transaction: jest.fn(),
      managedEmailTemplate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...template, signatureMode: 'default' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      emailTemplateVersion: {
        create: jest.fn(({ data }: { data: { snapshot: unknown } }) => {
          snapshot = data.snapshot;
          return { id: 'v1' };
        }),
      },
      emailPublication: {
        upsert: jest.fn(),
        findUnique: jest.fn(() => ({ version: { snapshot } })),
      },
      emailSenderProfile: {
        findUnique: jest.fn().mockResolvedValue({ defaultSignatureId: 's1' }),
      },
      emailSignature: {
        findFirst: jest.fn(() => ({
          document: { blocks: [{ type: 'text', text: signatureText }] },
        })),
      },
      auditLog: { create: jest.fn() },
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      {} as MailTransportFactory,
    );
    await service.action(
      EmailSenderKey.INFO,
      't',
      { action: 'publish', revision: 1, confirmed: true },
      1,
    );
    expect(db.emailPublication.upsert).toHaveBeenCalledWith({
      where: { senderKey_purpose: { senderKey: 'INFO', purpose: 'GENERIC' } },
      update: { versionId: 'v1' },
      create: { senderKey: 'INFO', purpose: 'GENERIC', versionId: 'v1' },
    });
    db.managedEmailTemplate.findFirst.mockResolvedValue({
      ...template,
      document: { blocks: [{ type: 'text', text: 'Borrador diferente' }] },
    });
    const published = await service.published(EmailSenderKey.INFO, 'GENERIC', {
      subject: 'Asunto',
      message: 'Hola',
    });
    expect(published?.text).toContain('Original Hola');
    expect(published?.text).not.toContain('Borrador diferente');
    expect(published?.text).toContain('Firma inicial');
    signatureText = 'Firma actualizada';
    expect(
      (
        await service.published(EmailSenderKey.INFO, 'GENERIC', {
          subject: 'Asunto',
          message: 'Hola',
        })
      )?.text,
    ).toContain('Firma actualizada');
    expect(db.emailSignature.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', senderKey: 'INFO', archivedAt: null },
    });
  });
  it('rejects publication without confirmation or from the wrong sender', async () => {
    const db = {
      $transaction: jest.fn(),
      managedEmailTemplate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...template, purpose: 'PASSWORD_RESET' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      {} as MailTransportFactory,
    );
    await expect(
      service.action(
        EmailSenderKey.INFO,
        't',
        { action: 'publish', revision: 1, confirmed: true },
        1,
      ),
    ).rejects.toThrow('Confirma');
    db.managedEmailTemplate.findFirst.mockResolvedValue(template);
    await expect(
      service.action(
        EmailSenderKey.INFO,
        't',
        { action: 'publish', revision: 1, confirmed: false },
        1,
      ),
    ).rejects.toThrow('Confirma');
  });
  it('sends tests only through the selected transport, audits without content and enforces rate limits', async () => {
    const sendMail = jest.fn().mockResolvedValue({
      messageId: 'mock',
      accepted: ['alex@example.test'],
    });
    const transport = {
      getTransport: jest.fn().mockReturnValue({ sendMail }),
      getFrom: jest.fn().mockReturnValue('info@example.test'),
    };
    const db = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
      managedEmailTemplate: {
        findFirst: jest.fn().mockResolvedValue(template),
      },
      auditLog: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    };
    db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) =>
      run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport as unknown as MailTransportFactory,
    );
    jest.spyOn(service, 'metadata').mockReturnValue([
      {
        key: 'INFO',
        email: 'info@example.test',
        name: 'CRONOX',
        configured: true,
      },
    ]);
    await expect(
      service.test(EmailSenderKey.INFO, 't', 'alex@example.test', false, 1),
    ).rejects.toThrow('Confirma');
    expect(sendMail).not.toHaveBeenCalled();
    const result = await service.test(
      EmailSenderKey.INFO,
      't',
      'alex@example.test',
      true,
      1,
    );
    expect(result.messageId).toBe('mock');
    expect(transport.getTransport).toHaveBeenCalledWith(EmailSenderKey.INFO);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(
      'alex@example.test',
    );
    db.auditLog.count.mockResolvedValue(3);
    await expect(
      service.test(EmailSenderKey.INFO, 't', 'alex@example.test', true, 1),
    ).rejects.toThrow('Espera');
    expect(sendMail).toHaveBeenCalledTimes(1);
    db.auditLog.count.mockResolvedValue(0);
    db.auditLog.create
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(
      service.test(EmailSenderKey.INFO, 't', 'alex@example.test', true, 1),
    ).resolves.toMatchObject({ messageId: 'mock' });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
