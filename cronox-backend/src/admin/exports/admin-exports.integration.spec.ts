/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Role } from '@prisma/client';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { Response as SuperAgentResponse } from 'superagent';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminModule } from '../admin.module';
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

const binaryParser = (
  response: SuperAgentResponse,
  callback: (error: Error | null, body: unknown) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

const delegate = () => ({
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  findUnique: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn().mockResolvedValue({ id: 1 }),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
});

describe('Admin Excel exports through the real AdminModule', () => {
  let app: INestApplication;
  const prisma = {
    user: delegate(),
    order: delegate(),
    orderItem: delegate(),
    product: delegate(),
    productVariant: delegate(),
    stockMovement: delegate(),
    circleUpgradeRequest: delegate(),
    circlePromotionRequest: delegate(),
    promoCode: delegate(),
    promoCodeRedemption: delegate(),
    auditLog: delegate(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
  };

  const routes = [
    'users',
    'orders',
    'products',
    'inventory',
    'circles',
    'promo-codes',
    'audit',
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AdminModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthenticationGuard)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
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

  afterAll(async () => app?.close());

  it.each(
    routes.flatMap((route) =>
      ['all', 'filtered'].map((scope) => [route, scope]),
    ),
  )(
    'GET %s with scope=%s returns an openable XLSX rather than 404',
    async (route, scope) => {
      const response = await request(app.getHttpServer())
        .get(`/api/admin/exports/${route}?scope=${scope}`)
        .set('x-test-role', Role.SUPERADMIN)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(response.headers['content-type']).toContain(EXCEL_MIME);
      expect(response.headers['content-disposition']).toMatch(
        /attachment; filename="[a-z0-9_-]+\.xlsx"/i,
      );
      expect(response.headers['cache-control']).toContain('no-store');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(response.body as never);
      expect(workbook.worksheets.length).toBeGreaterThan(0);
    },
  );

  it.each([Role.ADMIN, Role.USER, Role.FRIEND])(
    'returns 403 to %s under the Super Admin-only policy',
    async (role) => {
      await request(app.getHttpServer())
        .get('/api/admin/exports/users?scope=all')
        .set('x-test-role', role)
        .expect(403);
    },
  );

  it('returns 401 without authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/exports/users?scope=all')
      .expect(401);
  });

  it.each([
    ['/api/admin/exports/unknown?scope=all', 400],
    ['/api/admin/exports/users?scope=unknown', 400],
    ['/api/admin/exports/users?scope=filtered&role=UNKNOWN', 400],
    ['/api/admin/exports/orders?scope=filtered&status=UNKNOWN', 400],
    ['/api/admin/exports/users?scope=filtered&password=secret', 400],
  ])('returns a controlled validation error for %s', async (url, status) => {
    const response = await request(app.getHttpServer())
      .get(url)
      .set('x-test-role', Role.SUPERADMIN)
      .expect(status);
    expect(response.body).toHaveProperty('message');
    expect(String(response.text)).not.toContain('Cannot GET');
  });

  it('requests every matching record without page/skip truncation', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/exports/users?scope=filtered&q=ana')
      .set('x-test-role', Role.SUPERADMIN)
      .expect(200);
    expect(prisma.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 5001 }),
    );
    expect(prisma.user.findMany.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'skip',
    );
  });
});
