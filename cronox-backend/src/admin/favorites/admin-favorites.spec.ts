import {
  ValidationPipe,
  UnauthorizedException,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminProductsController } from '../products/admin-products.controller';
import { AdminFavoritesController } from './admin-favorites.controller';
import {
  AdminFavoritesService,
  favoritesReportSql,
} from './admin-favorites.service';

describe('Admin favorites permissions, validation and query contract', () => {
  let app: INestApplication;
  const service = {
    report: jest.fn(async (q) => ({
      query: q,
      rows: [],
      summary: { favorites: 0, users: 0 },
    })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminFavoritesController],
      providers: [{ provide: AdminFavoritesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx) {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers['x-role']) throw new UnauthorizedException();
          req.user = { role: req.headers['x-role'] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  it('matches the product guards', () =>
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminFavoritesController),
    ).toEqual(Reflect.getMetadata(GUARDS_METADATA, AdminProductsController)));
  it('requires a session', () =>
    request(app.getHttpServer()).get('/admin/favorites').expect(401));
  it.each(['USER', 'FRIEND'])('denies %s', (role) =>
    request(app.getHttpServer())
      .get('/admin/favorites')
      .set('x-role', role)
      .expect(403),
  );
  it.each(['ADMIN', 'SUPERADMIN'])(
    'admits the existing management role %s',
    async (role) => {
      const r = await request(app.getHttpServer())
        .get('/admin/favorites')
        .set('x-role', role)
        .expect(200);
      expect(r.body.query).toEqual({ page: 1, sort: 'desc' });
    },
  );
  it.each([
    'page=0',
    'page=1.5',
    'sort=unsafe',
    'search=' + 'x'.repeat(121),
    'extra=yes',
  ])('rejects invalid %s', (q) =>
    request(app.getHttpServer())
      .get('/admin/favorites?' + q)
      .set('x-role', 'ADMIN')
      .expect(400),
  );
  it('parameterizes search and uses no account eligibility filters', () => {
    const sql = favoritesReportSql({
      page: 2,
      sort: 'asc',
      search: "' OR 1=1 --",
    });
    expect(sql.text).not.toContain("' OR 1=1 --");
    expect(sql.text).toContain('DISTINCT');
    expect(sql.text).toContain('LEFT JOIN counts');
    expect(sql.text).not.toMatch(/password|accountState|newsletter/);
    expect(sql.values).toContain(25);
  });
});
