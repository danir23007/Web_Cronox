import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/roles.decorator';
/* eslint-disable @typescript-eslint/unbound-method */
import {
  ResetMediaFramingDto,
  SelectWebsiteMediaAssetDto,
  UpdateMediaFramingDto,
} from './dto/media-frame.dto';
import {
  AdminMediaFramingController,
  MediaFramingController,
  WEBSITE_MEDIA_UPLOAD_MULTER_LIMITS,
} from './media-framing.controller';
import { MediaFramingService } from './media-framing.service';
import { WEBSITE_MEDIA_UPLOAD_TOO_LARGE_MESSAGE } from './media-upload-size-exception.filter';

const validPayload = {
  desktop: { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' },
  tablet: null,
  mobile: null,
  expectedRevision: 0,
};

describe('media framing controller security and validation', () => {
  it('requires authenticated admin roles and excludes ordinary users', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminMediaFramingController,
    ) as unknown[];
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AdminMediaFramingController,
    ) as Role[];
    expect(guards).toEqual([JwtAuthGuard, AdminGuard, RolesGuard]);
    expect(roles).toContain(Role.ADMIN);
    expect(roles).toContain(Role.MARKETING);
    expect(roles).not.toContain(Role.USER);

    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(roles),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const contextFor = (role?: Role) =>
      ({
        getHandler: () => contextFor,
        getClass: () => AdminMediaFramingController,
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { role } : undefined }),
        }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(Role.USER))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(contextFor(Role.ADMIN))).toBe(true);
  });

  it('keeps the minimum public framing endpoint free of admin guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MediaFramingController),
    ).toBeUndefined();
  });

  it('caps admin uploads at 100 MB with a clear message', () => {
    expect(WEBSITE_MEDIA_UPLOAD_MULTER_LIMITS).toEqual({
      files: 1,
      fileSize: 100 * 1024 * 1024,
    });
    expect(WEBSITE_MEDIA_UPLOAD_TOO_LARGE_MESSAGE).toContain('100 MB');
  });

  it.each([
    [
      'horizontal position',
      { desktop: { ...validPayload.desktop, focalX: -1 } },
    ],
    [
      'vertical position',
      { desktop: { ...validPayload.desktop, focalY: 101 } },
    ],
    ['zoom', { desktop: { ...validPayload.desktop, zoom: 3.1 } }],
    ['NaN-like number', { desktop: { ...validPayload.desktop, zoom: 'NaN' } }],
    [
      'Infinity-like number',
      { desktop: { ...validPayload.desktop, zoom: 'Infinity' } },
    ],
    ['fit mode', { desktop: { ...validPayload.desktop, fit: 'STRETCH' } }],
    ['unexpected property', { arbitrarySelector: '#checkout' }],
  ])('rejects invalid %s input', async (_label, override) => {
    const dto = plainToInstance(UpdateMediaFramingDto, {
      ...validPayload,
      ...override,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts finite general, tablet, and mobile frames plus reset revisions', async () => {
    const update = plainToInstance(UpdateMediaFramingDto, {
      ...validPayload,
      tablet: { focalX: 20, focalY: 40, zoom: 1.5, fit: 'CONTAIN' },
      mobile: { focalX: 80, focalY: 60, zoom: 2, fit: 'COVER' },
    });
    const reset = plainToInstance(ResetMediaFramingDto, {
      expectedRevision: 3,
    });
    const selection = plainToInstance(SelectWebsiteMediaAssetDto, {
      assetId: 'asset-1',
      expectedRevision: 3,
    });
    expect(await validate(update)).toHaveLength(0);
    expect(await validate(reset)).toHaveLength(0);
    expect(await validate(selection)).toHaveLength(0);
  });

  it('delegates reads, writes, and reset with actor and revision data', async () => {
    const service = {
      getAdminPlacements: jest.fn().mockResolvedValue({ placements: [] }),
      getAdminPlacement: jest.fn().mockResolvedValue({ placement: {} }),
      getAssetLibrary: jest.fn().mockResolvedValue({ folders: [] }),
      uploadAsset: jest.fn().mockResolvedValue({ asset: {} }),
      selectAsset: jest.fn().mockResolvedValue({ placement: {} }),
      updatePlacement: jest.fn().mockResolvedValue({ placement: {} }),
      resetPlacement: jest.fn().mockResolvedValue({ placement: {} }),
    } as unknown as MediaFramingService;
    const controller = new AdminMediaFramingController(service);
    await controller.getPlacements();
    await controller.getPlacement('home.hero.video');
    await controller.getLibrary();
    await controller.uploadAsset('home.hero.video', undefined, 9);
    await controller.selectAsset(
      'home.hero.video',
      { assetId: 'asset-1', expectedRevision: 0 },
      9,
    );
    await controller.updatePlacement(
      'home.hero.video',
      validPayload as UpdateMediaFramingDto,
      9,
    );
    await controller.resetPlacement(
      'home.hero.video',
      { expectedRevision: 1 },
      9,
    );
    expect(service.updatePlacement).toHaveBeenCalledWith(
      'home.hero.video',
      validPayload,
      9,
    );
    expect(service.resetPlacement).toHaveBeenCalledWith(
      'home.hero.video',
      { expectedRevision: 1 },
      9,
    );
    expect(service.uploadAsset).toHaveBeenCalledWith(
      'home.hero.video',
      undefined,
      9,
    );
    expect(service.selectAsset).toHaveBeenCalledWith(
      'home.hero.video',
      { assetId: 'asset-1', expectedRevision: 0 },
      9,
    );
  });
});
