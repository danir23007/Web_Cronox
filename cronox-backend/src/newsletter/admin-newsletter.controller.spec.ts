import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/roles.decorator';
import { AdminNewsletterController } from './admin-newsletter.controller';
import { UpdateNewsletterSettingsDto } from './dto/newsletter-settings.dto';
import { NewsletterController } from './newsletter.controller';

describe('Admin Newsletter security and validation', () => {
  const valid = {
    mediaAssetId: 'asset-1',
    desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
    mobile: { focalX: 40, focalY: 60, zoom: 2, fit: 'COVER' },
    asciiEnabled: true,
    asciiOpacity: 0.75,
    expectedRevision: 0,
  };

  it('requires ADMIN or SUPERADMIN', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminNewsletterController),
    ).toEqual([JwtAuthGuard, AdminGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminNewsletterController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('keeps the projected public configuration endpoint unguarded', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, NewsletterController),
    ).toBeUndefined();
  });

  it.each([
    ['opacity below zero', { asciiOpacity: -0.01 }],
    ['opacity above one', { asciiOpacity: 1.01 }],
    ['invalid zoom', { desktop: { ...valid.desktop, zoom: 3.01 } }],
    ['invalid focal coordinate', { mobile: { ...valid.mobile, focalX: 101 } }],
  ])('rejects %s', async (_label, override) => {
    const dto = plainToInstance(UpdateNewsletterSettingsDto, {
      ...valid,
      ...override,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts a complete valid payload', async () => {
    const dto = plainToInstance(UpdateNewsletterSettingsDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });
});
