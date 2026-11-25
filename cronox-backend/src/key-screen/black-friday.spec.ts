import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BlackFridayService, SaveBlackFridayDto } from './black-friday';
import { ValidationPipe } from '@nestjs/common';
import { SetKeyScreenEnabledDto, SetKeyScreenExpirationDto, UpdateKeyScreenDto } from './dto/key-screen.dto';

const valid = {
  enabled: true,
  title: 'BLACK FRIDAY',
  bannerText: 'BLACK FRIDAY · 27/11',
  eventText: 'YA ESTÁ AQUÍ',
  startsAt: '2026-11-26T23:00:00.000Z',
  endsAt: '2026-11-27T23:00:00.000Z',
  textColor: '#ffffff',
  backgroundColor: '#111111',
  revision: 1,
};
describe('Black Friday visual settings', () => {
  it('rejects cross-form fields using the production validation policy', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    for (const [metatype, value] of [
      [SaveBlackFridayDto, { ...valid, activeScreenId: 'old-preregistration', expiresAt: null }],
      [SetKeyScreenEnabledDto, { enabled: false, bannerText: valid.bannerText }],
      [SetKeyScreenExpirationDto, { expiresAt: null, startsAt: valid.startsAt }],
      [UpdateKeyScreenDto, { expectedRevision: 1, title: 'Guardada', bannerText: valid.bannerText }],
    ] as const) {
      await expect(pipe.transform(value, { type: 'body', metatype })).rejects.toThrow();
    }
  });

  it.each([true, false])('saving campaign enabled=%s never writes preregistration settings', async (enabled) => {
    const gate = { enabled: false, activeScreenId: 'saved' };
    const keyScreenSettings = { update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn() };
    const blackFridaySettings = { upsert: jest.fn().mockResolvedValue(valid), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const service = new BlackFridayService({ keyScreenSettings, blackFridaySettings } as never);
    await service.save({ ...valid, enabled, activeScreenId: gate.activeScreenId } as SaveBlackFridayDto);
    expect(blackFridaySettings.updateMany.mock.calls[0][0].data).not.toHaveProperty('activeScreenId');
    for (const write of Object.values(keyScreenSettings)) expect(write).not.toHaveBeenCalled();
  });
  const setup = () => {
    const table = {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { blackFridaySettings: table };
    return { table, service: new BlackFridayService(prisma as never) };
  };
  it('fails open on missing configuration, database errors, disabled and expired campaigns', async () => {
    const { table, service } = setup();
    for (const row of [
      null,
      { enabled: false },
      { enabled: true, endsAt: new Date(0) },
    ]) {
      table.findUnique.mockResolvedValue(row);
      expect(await service.publicState()).toEqual(
        expect.objectContaining({ enabled: false }),
      );
    }
    table.findUnique.mockRejectedValue(new Error('database unavailable'));
    expect(await service.publicState()).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });
  it('saves only the independent table with optimistic concurrency, retaining disabled values', async () => {
    const { table, service } = setup();
    table.upsert.mockResolvedValue(valid);
    await service.save({ ...valid, enabled: false }, 7);
    expect(table.updateMany).toHaveBeenCalledWith({
      where: { id: 'global', revision: 1 },
      data: {
        ...valid,
        enabled: false,
        revision: { increment: 1 },
        updatedBy: 7,
        startsAt: new Date(valid.startsAt),
        endsAt: new Date(valid.endsAt),
      },
    });
    table.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save(valid)).rejects.toThrow('Recarga');
  });
  it('rejects invalid intervals before writing', async () => {
    const { table, service } = setup();
    for (const endsAt of [valid.startsAt, 'invalid', '2026-01-01T00:00:00Z']) {
      await expect(service.save({ ...valid, endsAt })).rejects.toThrow(
        'posterior',
      );
    }
    expect(table.updateMany).not.toHaveBeenCalled();
  });
  it('validates explicit absolute timestamps, booleans, bounded text and hex colors', async () => {
    expect(
      await validate(plainToInstance(SaveBlackFridayDto, valid)),
    ).toHaveLength(0);
    for (const patch of [
      { enabled: 'true' },
      { startsAt: '2026-11-27T00:00:00' },
      { endsAt: '2026-02-30T00:00:00Z' },
      { title: '' },
      { bannerText: 'x'.repeat(241) },
      { textColor: 'red' },
      { backgroundColor: 'url(x)' },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(SaveBlackFridayDto, { ...valid, ...patch }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});
