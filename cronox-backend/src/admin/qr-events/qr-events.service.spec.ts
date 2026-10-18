import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { CircleService } from '../../membership/circle.service';
import { QrEventsService } from './qr-events.service';

const GROUP = '2ea75349-6cc1-4a2d-afcb-dee838cb3d08';
const USER_IDENTITY = '8293dd30-e7cd-41dc-a50d-58a3bd939a2e';
const ACTOR_IDENTITY = '24d14588-4472-47ec-87d0-3a0d4b2335f1';

function setup(ids: Array<number | null> = [10, 3, 2]) {
  const group = {
    id: GROUP,
    name: 'Prueba',
    description: '',
    archived: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    _count: { participants: ids.length },
  };
  const tx = {
    qrEventGroup: { findUnique: jest.fn().mockResolvedValue(group) },
    qrEventParticipant: {
      count: jest.fn().mockResolvedValue(ids.length),
      findMany: jest
        .fn()
        .mockResolvedValue(
          ids.map((id) => ({ user: id === null ? null : { id } })),
        ),
    },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  const service = new QrEventsService(
    prisma as unknown as PrismaService,
    {} as CircleService,
  );
  return { group, tx, prisma, service };
}

describe('QR event IDs', () => {
  it('resolves old registrations through User.id without changing UUIDs or historical fields', async () => {
    const { service, tx } = setup([23]);
    const registeredAt = new Date('2025-12-15T23:45:32.000Z');
    tx.qrEventParticipant.findMany.mockResolvedValue([
      {
        id: 'c5c7f591-8f63-47d7-898b-529198040048',
        user: {
          id: 23,
          identityUid: USER_IDENTITY,
          firstName: 'Persona',
          publicMemberToken: 'a'.repeat(32),
          circleLevel: 5,
        },
        registeredBy: {
          id: 2,
          identityUid: ACTOR_IDENTITY,
          firstName: 'Admin',
        },
        circleAtRegistration: 3,
        registeredAt,
      },
    ]);
    const result = await service.participants(GROUP, { page: 1, limit: 50 });
    expect(result.items[0]).toMatchObject({
      userId: 23,
      publicUserId: USER_IDENTITY,
      qrIdentifier: 'a'.repeat(32),
      circleAtRegistration: 3,
      registeredAt,
      registeredBy: { id: 2, publicUserId: ACTOR_IDENTITY },
      deleted: false,
    });
  });

  it('represents deliberately anonymized history without inventing an ID', async () => {
    const { service, tx } = setup([null]);
    tx.qrEventParticipant.findMany.mockResolvedValue([
      {
        id: GROUP,
        user: null,
        registeredBy: null,
        circleAtRegistration: 4,
        registeredAt: new Date(),
      },
    ]);
    const result = await service.participants(GROUP, { page: 1, limit: 50 });
    expect(result.items[0]).toMatchObject({
      userId: null,
      publicUserId: null,
      deleted: true,
      circleAtRegistration: 4,
    });
  });

  it('searches by the authentic numeric ID in addition to existing name and QR searches', async () => {
    const { service, tx } = setup([]);
    await service.participants(GROUP, { page: 1, limit: 50, q: '23' });
    expect(
      tx.qrEventParticipant.findMany.mock.calls[0][0].where.user.OR,
    ).toContainEqual({ id: 23 });
  });

  it.each(['2147483648', '9999999999999999999999999', '-1', '12.3', '12x'])(
    'does not send an invalid PostgreSQL integer as a numeric ID search: %s',
    async (q) => {
      const { service, tx } = setup([]);
      await service.participants(GROUP, { page: 1, limit: 50, q });
      expect(
        tx.qrEventParticipant.findMany.mock.calls[0][0].where.user.OR.some(
          (part: object) => 'id' in part,
        ),
      ).toBe(false);
    },
  );

  it('builds exactly one XLSX sheet/column with numeric, distinct, numerically sorted authentic IDs', async () => {
    const { service, tx, prisma } = setup([10, 2, 3, 2, 2147483647]);
    const result = await service.exportIds(GROUP);
    expect(result.filename).toBe('eventos-qr-prueba-ids.xlsx');
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(result.buffer).buffer);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('IDs');
    expect(sheet.columnCount).toBe(1);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.getCell('A1').value).toBe('ID de usuario');
    expect([2, 3, 4, 5].map((row) => sheet.getCell(row, 1).value)).toEqual([
      2, 3, 10, 2147483647,
    ]);
    for (const row of [2, 3, 4, 5]) {
      expect(sheet.getCell(row, 1).type).toBe(ExcelJS.ValueType.Number);
      expect(sheet.getCell(row, 1).numFmt).toBe('0');
    }
    expect(tx.qrEventParticipant.findMany).toHaveBeenCalledWith({
      where: { groupId: GROUP },
      select: { user: { select: { id: true } } },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('exports all pages and selects no names, dates, UUIDs or QR tokens', async () => {
    const ids = Array.from({ length: 125 }, (_, index) => 126 - index);
    const { service } = setup(ids);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Uint8Array.from((await service.exportIds(GROUP)).buffer).buffer,
    );
    const sheet = workbook.worksheets[0];
    expect(sheet.columnCount).toBe(1);
    expect(sheet.rowCount).toBe(126);
    const values: unknown[] = [];
    sheet.eachRow((row, index) => {
      if (index > 1) values.push(row.getCell(1).value);
    });
    expect(values).toEqual([...ids].sort((a, b) => a - b));
  });

  it.each([
    [
      'Prúeba / evento "\r\nX-Test: sí',
      'eventos-qr-prueba-evento-x-test-si-ids.xlsx',
    ],
    ['😀', 'eventos-qr-grupo-ids.xlsx'],
  ])('uses a safe recognizable filename for %s', async (name, filename) => {
    const { service, group } = setup();
    group.name = name;
    expect((await service.exportIds(GROUP)).filename).toBe(filename);
  });

  it('rejects an empty group instead of generating a misleading export', async () => {
    const { service } = setup([]);
    await expect(service.exportIds(GROUP)).rejects.toMatchObject({
      response: { code: 'EMPTY_GROUP' },
      status: 400,
    });
  });

  it('rejects incomplete IDs instead of silently excluding old anonymous registrations', async () => {
    const { service } = setup([2, null, 10]);
    await expect(service.exportIds(GROUP)).rejects.toMatchObject({
      response: { code: 'UNRESOLVED_PARTICIPANT_ID' },
      status: 409,
    });
  });

  it.each([false, true])(
    'rejects a missing/archived group: archived=%s',
    async (archived) => {
      const { service, tx, group } = setup();
      tx.qrEventGroup.findUnique.mockResolvedValue(
        archived ? { ...group, archived: true } : null,
      );
      await expect(service.exportIds(GROUP)).rejects.toMatchObject({
        response: { code: 'GROUP_UNAVAILABLE' },
        status: 404,
      });
      expect(tx.qrEventParticipant.findMany).not.toHaveBeenCalled();
    },
  );
});
