import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderKey } from '../email.types';
import { MailTransportFactory } from '../mail-transport.factory';
import { MailMultiSaveDto } from './mail.dto';
import { ManagedMailService } from './managed-mail.service';

const transport = {} as MailTransportFactory;
const source = {
  id: 't1',
  senderKey: 'ORDERS',
  folderId: 'f1',
  name: 'Confirmación 1',
  purpose: 'ORDER_CONFIRMATION',
  subject: 'Anterior',
  preheader: '',
  document: { blocks: [{ type: 'text', text: 'Anterior' }] },
  html: '<p>Anterior</p>',
  text: 'Anterior',
  signatureMode: 'none',
  signatureId: null,
  revision: 1,
  archivedAt: null,
  folder: { name: 'Círculo 1' },
};
const dto = (): MailMultiSaveDto => ({
  name: source.name,
  folderId: source.folderId,
  subject: 'Asunto sincronizado',
  preheader: 'Preheader sincronizado',
  purpose: source.purpose,
  document: {
    blocks: [
      {
        type: 'orderItems',
        labels: { empty: 'Sin artículos' },
        background: '#112233',
      },
      {
        type: 'image',
        src: 'https://storage.example.test/shared.png',
        alt: 'Producto',
      },
    ],
  },
  signatureMode: 'none',
  revision: 1,
  targets: [
    { id: 't1', revision: 1 },
    { id: 't2', revision: 4 },
  ],
});

describe('same-purpose multi-circle draft saving', () => {
  it('discovers only exact-purpose templates in the same sender account', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 't1',
        folderId: 'f1',
        revision: 1,
        folder: { name: 'Círculo 1', position: 0 },
      },
      {
        id: 't2',
        folderId: 'f2',
        revision: 3,
        folder: { name: 'Círculo 2', position: 1 },
      },
    ]);
    const db = {
      managedEmailTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          ...source,
          folder: { name: 'Círculo 1', position: 0 },
        }),
        findMany,
      },
    };
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport,
    );

    const result = await service.draftTargets(EmailSenderKey.ORDERS, 't1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          senderKey: 'ORDERS',
          purpose: 'ORDER_CONFIRMATION',
          archivedAt: null,
          OR: [{ id: 't1' }, { folderId: { not: 'f1' } }],
        },
      }),
    );
    expect(result.targets.map((target) => target.folderName)).toEqual([
      'Círculo 1',
      'Círculo 2',
    ]);
    expect(result.targets[0].current).toBe(true);
  });

  it('updates selected drafts atomically and preserves identities, publications and shared image URLs', async () => {
    const rows = new Map<string, Record<string, unknown>>([
      ['t1', { ...source }],
      [
        't2',
        {
          ...source,
          id: 't2',
          folderId: 'f2',
          name: 'Confirmación 2',
          revision: 4,
          folder: { name: 'Círculo 2' },
        },
      ],
      [
        't3',
        {
          ...source,
          id: 't3',
          folderId: 'f3',
          name: 'Confirmación 3',
          revision: 2,
          folder: { name: 'Círculo 3' },
        },
      ],
    ]);
    const publicationUpdate = jest.fn();
    const versionCreate = jest.fn();
    const db = {
      $transaction: jest.fn(),
      managedEmailTemplate: {
        findFirst: jest.fn(
          ({ where }: { where: { id: string; senderKey: string } }) => {
            const row = rows.get(where.id);
            return row?.senderKey === where.senderKey ? row : null;
          },
        ),
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => rows.get(id)).filter(Boolean),
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string; revision: number };
            data: Record<string, unknown>;
          }) => {
            const row = rows.get(where.id);
            if (!row || row.revision !== where.revision) return { count: 0 };
            rows.set(where.id, {
              ...row,
              ...data,
              revision: Number(row.revision) + 1,
            });
            return { count: 1 };
          },
        ),
      },
      emailTemplateFolder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'f1',
          senderKey: 'ORDERS',
          name: 'Círculo 1',
        }),
      },
      emailPublication: { update: publicationUpdate },
      emailTemplateVersion: { create: versionCreate },
      auditLog: { create: jest.fn() },
    };
    db.$transaction.mockImplementation(
      (run: (tx: typeof db) => Promise<unknown>) => run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport,
    );

    const result = await service.saveDrafts(
      EmailSenderKey.ORDERS,
      't1',
      dto(),
      7,
    );

    for (const id of ['t1', 't2']) {
      const row = rows.get(id)!;
      expect(row.subject).toBe('Asunto sincronizado');
      expect(row.preheader).toBe('Preheader sincronizado');
      expect(JSON.stringify(row.document)).toContain('orderItems');
      expect(JSON.stringify(row.document)).toContain(
        'https://storage.example.test/shared.png',
      );
    }
    expect(rows.get('t2')).toMatchObject({
      id: 't2',
      folderId: 'f2',
      name: 'Confirmación 2',
      revision: 5,
    });
    expect(rows.get('t3')).toMatchObject({
      subject: 'Anterior',
      revision: 2,
    });
    expect(publicationUpdate).not.toHaveBeenCalled();
    expect(versionCreate).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(result.updated.map((target) => target.id)).toEqual(['t1', 't2']);
    await expect(
      service.template(EmailSenderKey.ORDERS, 't2'),
    ).resolves.toMatchObject({
      subject: 'Asunto sincronizado',
      preheader: 'Preheader sincronizado',
    });
  });

  it.each([
    ['missing target', null, 'no existe'],
    [
      'wrong purpose',
      { ...source, id: 't2', purpose: 'ORDER_SHIPPED', revision: 4 },
      'mismo propósito',
    ],
    [
      'wrong sender',
      { ...source, id: 't2', senderKey: 'SUPPORT', revision: 4 },
      'otra cuenta',
    ],
    [
      'stale target revision',
      { ...source, id: 't2', revision: 5 },
      'otra sesión',
    ],
  ])('rejects a %s before writing', async (_case, target, message) => {
    const updateMany = jest.fn();
    const db = {
      $transaction: jest.fn(),
      managedEmailTemplate: {
        findFirst: jest.fn().mockResolvedValue(source),
        findMany: jest
          .fn()
          .mockResolvedValue(target ? [source, target] : [source]),
        updateMany,
      },
      emailTemplateFolder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'f1' }),
      },
    };
    db.$transaction.mockImplementation(
      (run: (tx: typeof db) => Promise<unknown>) => run(db),
    );
    const service = new ManagedMailService(
      db as unknown as PrismaService,
      transport,
    );

    await expect(
      service.saveDrafts(EmailSenderKey.ORDERS, 't1', dto()),
    ).rejects.toThrow(message);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('requires the source template and rejects duplicate selections', async () => {
    const service = new ManagedMailService({} as PrismaService, transport);
    const invalid = dto();
    invalid.targets = [
      { id: 't2', revision: 4 },
      { id: 't2', revision: 4 },
    ];
    await expect(
      service.saveDrafts(EmailSenderKey.ORDERS, 't1', invalid),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
