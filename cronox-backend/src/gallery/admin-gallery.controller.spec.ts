import {
  ArgumentsHost,
  ExecutionContext,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/roles.decorator';
import {
  AdminGalleryController,
  GALLERY_UPLOAD_MULTER_LIMITS,
} from './admin-gallery.controller';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import {
  GALLERY_UPLOAD_TOO_LARGE_MESSAGE,
  GalleryUploadSizeExceptionFilter,
} from './gallery-upload-size-exception.filter';

describe('gallery controller access boundaries', () => {
  it('protects every admin gallery route with authentication and admin roles', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminGalleryController,
    ) as unknown[];
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AdminGalleryController,
    ) as Role[];

    expect(guards).toEqual([JwtAuthGuard, AdminGuard, RolesGuard]);
    expect(roles).toEqual(
      expect.arrayContaining([
        Role.SUPER_ADMIN,
        Role.MODERATOR,
        Role.LOGISTICS,
        Role.MARKETING,
        Role.ADMIN,
        Role.SUPERADMIN,
      ]),
    );
    expect(roles).not.toContain(Role.USER);
  });

  it('keeps the public gallery read endpoint free of admin guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, GalleryController),
    ).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, GalleryController)).toBeUndefined();
  });

  it('rejects unauthenticated and USER roles while accepting an Admin role', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AdminGalleryController,
    ) as Role[];
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(roles),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const contextFor = (role?: Role) =>
      ({
        getHandler: () => contextFor,
        getClass: () => AdminGalleryController,
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

  it('delegates reads, uploads, and slot updates to the gallery service', async () => {
    const getAdminSlots = jest.fn().mockResolvedValue({ slots: [] });
    const getAssetLibrary = jest.fn().mockResolvedValue({ assets: [] });
    const uploadAsset = jest
      .fn()
      .mockResolvedValue({ asset: { id: 'asset-1' } });
    const updateSlot = jest
      .fn()
      .mockResolvedValue({ slot: { key: 'slot-01' } });
    const service = {
      getAdminSlots,
      getAssetLibrary,
      uploadAsset,
      updateSlot,
    } as unknown as GalleryService;
    const controller = new AdminGalleryController(service);
    const file = {} as Express.Multer.File;

    await controller.getSlots();
    await controller.getAssets();
    await controller.uploadAsset(file, 12);
    await controller.updateSlot('slot-01', { altText: 'Cliente CRONOX' }, 12);

    expect(getAdminSlots).toHaveBeenCalled();
    expect(getAssetLibrary).toHaveBeenCalled();
    expect(uploadAsset).toHaveBeenCalledWith(file, 12);
    expect(updateSlot).toHaveBeenCalledWith(
      'slot-01',
      { altText: 'Cliente CRONOX' },
      12,
    );
  });

  it('returns a clear 25 MB message when Multer rejects an oversized gallery upload', () => {
    const json = jest.fn();
    const response = {
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;

    new GalleryUploadSizeExceptionFilter().catch(
      new PayloadTooLargeException('File too large'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        message: GALLERY_UPLOAD_TOO_LARGE_MESSAGE,
      }),
    );
    expect(GALLERY_UPLOAD_TOO_LARGE_MESSAGE).toContain('25 MB');
    expect(GALLERY_UPLOAD_MULTER_LIMITS).toEqual({
      files: 1,
      fileSize: 25 * 1024 * 1024,
    });
  });
});
