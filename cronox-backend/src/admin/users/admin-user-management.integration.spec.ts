/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserAccountState } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

class HeaderAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const role = request.headers['x-test-role'];
    if (!role) throw new UnauthorizedException('Usuario no autenticado');
    request.user = { id: 99, role };
    return true;
  }
}

describe('Super Admin user management (HTTP integration)', () => {
  let app: INestApplication;
  let usersService: {
    listUsers: jest.Mock;
    getEditOptions: jest.Mock;
    updateAdminUser: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      listUsers: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getEditOptions: jest.fn().mockReturnValue({
        roles: Object.values(Role),
        accountStates: Object.values(UserAccountState),
        circles: [1, 2, 3, 4, 5],
        circleNullable: false,
      }),
      updateAdminUser: jest.fn((id, dto) => {
        if (id === 404) throw new NotFoundException('Usuario no encontrado');
        return {
          id,
          name: dto.name,
          phone: dto.phone,
          role: dto.role,
          accountState: dto.accountState,
          circle: dto.circleLevel,
          updatedAt: '2026-09-15T09:00:00.000Z',
        };
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        AdminGuard,
        RolesGuard,
        SuperAdminGuard,
        { provide: AdminUsersService, useValue: usersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthenticationGuard)
      .compile();

    app = module.createNestApplication();
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

  afterEach(async () => app.close());

  const validUpdate = {
    name: 'Nombre actualizado',
    phone: '+34 611 222 333',
    role: Role.FRIEND,
    accountState: UserAccountState.ACTIVE,
    circleLevel: 3,
    expectedUpdatedAt: '2026-09-15T08:00:00.000Z',
  };

  it('allows SUPERADMIN to update protected fields', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/admin/users/7')
      .set('x-test-role', Role.SUPERADMIN)
      .send(validUpdate)
      .expect(200);

    expect(response.body).toMatchObject({ id: 7, role: Role.FRIEND });
    expect(usersService.updateAdminUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining(validUpdate),
      99,
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it('accepts removing the nullable account phone', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/admin/users/7')
      .set('x-test-role', Role.SUPERADMIN)
      .send({ ...validUpdate, phone: null })
      .expect(200);

    expect(response.body.phone).toBeNull();
    expect(usersService.updateAdminUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ phone: null }),
      99,
      expect.any(Object),
    );
  });

  it.each([Role.ADMIN, Role.USER, Role.FRIEND, 'SUPER_ADMIN'])(
    'returns 403 when %s attempts a protected update',
    async (role) => {
      await request(app.getHttpServer())
        .patch('/api/admin/users/7')
        .set('x-test-role', role)
        .send(validUpdate)
        .expect(403);
      expect(usersService.updateAdminUser).not.toHaveBeenCalled();
    },
  );

  it('returns 401 when unauthenticated', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/users/7')
      .send(validUpdate)
      .expect(401);
  });

  it.each([
    ['invalid role', { role: 'OWNER' }],
    ['legacy Super Admin spelling', { role: 'SUPER_ADMIN' }],
    ['invalid status', { accountState: 'BLOCKED' }],
    ['invalid circle', { circleLevel: 99 }],
    ['malformed international phone', { phone: '34+600ABC' }],
    ['null circle unsupported by the schema', { circleLevel: null }],
    ['unknown mass-assignment field', { password: 'replacement' }],
  ])('rejects %s', async (_label, invalidField) => {
    await request(app.getHttpServer())
      .patch('/api/admin/users/7')
      .set('x-test-role', Role.SUPERADMIN)
      .send({ ...validUpdate, ...invalidField })
      .expect(400);
    expect(usersService.updateAdminUser).not.toHaveBeenCalled();
  });

  it('returns a clear 404 if the target disappeared', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/admin/users/404')
      .set('x-test-role', Role.SUPERADMIN)
      .send(validUpdate)
      .expect(404);
    expect(response.body.message).toBe('Usuario no encontrado');
  });

  it('keeps list access for ADMIN and blocks FRIEND', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('x-test-role', Role.ADMIN)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('x-test-role', Role.FRIEND)
      .expect(403);
  });
});
