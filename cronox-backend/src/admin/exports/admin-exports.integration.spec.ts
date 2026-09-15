/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminExportsController } from './admin-exports.controller';
import { AdminExportsService } from './admin-exports.service';
import { EXCEL_MIME } from './excel-workbook.service';

class HeaderAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException('Usuario no autenticado');
    req.user = { id: 41, role };
    return true;
  }
}

describe('Admin Excel exports (HTTP integration)', () => {
  let app: INestApplication;
  const exportsService = {
    export: jest.fn().mockResolvedValue({
      buffer: Buffer.from('PK-test'),
      filename: 'cronox_usuarios_2026-09-15_1200.xlsx',
      rowCount: 1,
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminExportsController],
      providers: [
        AdminGuard,
        RolesGuard,
        SuperAdminGuard,
        { provide: AdminExportsService, useValue: exportsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthenticationGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => exportsService.export.mockClear());

  it('allows SUPERADMIN and returns a non-cacheable XLSX attachment', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/exports/users?scope=filtered&q=ana')
      .set('x-test-role', Role.SUPERADMIN)
      .expect(200);
    expect(response.headers['content-type']).toContain(EXCEL_MIME);
    expect(response.headers['content-disposition']).toContain('.xlsx');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(exportsService.export).toHaveBeenCalledWith(
      'usuarios',
      expect.objectContaining({ scope: 'filtered', q: 'ana' }),
      41,
      expect.any(Object),
    );
  });

  it.each([Role.ADMIN, Role.USER, Role.FRIEND])(
    'returns 403 to %s',
    async (role) => {
      await request(app.getHttpServer())
        .get('/api/admin/exports/users')
        .set('x-test-role', role)
        .expect(403);
      expect(exportsService.export).not.toHaveBeenCalled();
    },
  );

  it('returns 401 without authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/exports/users')
      .expect(401);
  });

  it('rejects unknown query fields instead of mass-assigning them', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/exports/users?password=secret')
      .set('x-test-role', Role.SUPERADMIN)
      .expect(400);
    expect(exportsService.export).not.toHaveBeenCalled();
  });
});
