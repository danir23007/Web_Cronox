import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminOrdersController } from '../admin/orders/admin-orders.controller';
import { AdminOrdersService } from '../admin/orders/admin-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingLabelsService } from './labels.service';
import { TrackingAdminController } from './tracking-admin.controller';
import { TrackingService } from './tracking.service';

describe('bulk tracking HTTP permissions and envelope validation', () => {
  let app: INestApplication;
  const admin = { assignTrackingBulk: jest.fn(async () => ({ results: [] })) };
  const tracking = { syncBulk: jest.fn(async () => ({ results: [] })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AdminOrdersController, TrackingAdminController],
      providers: [{ provide: AdminOrdersService, useValue: admin }, { provide: TrackingService, useValue: tracking },
        { provide: ShippingLabelsService, useValue: {} }, { provide: PrismaService, useValue: {} }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: any) {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-fixture-role']) throw new UnauthorizedException();
        req.user = { id: 7, role: req.headers['x-fixture-role'] }; return true;
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());
  it.each(['assign', 'sync'])('requires SUPERADMIN for %s before invoking any provider', async action => {
    const path = '/api/admin/orders/tracking-bulk/' + action;
    await request(app.getHttpServer()).post(path).send({}).expect(401);
    for (const role of ['USER', 'FRIEND', 'ADMIN']) await request(app.getHttpServer()).post(path).set('x-fixture-role', role).send({}).expect(403);
    expect(admin.assignTrackingBulk).not.toHaveBeenCalled(); expect(tracking.syncBulk).not.toHaveBeenCalled();
  });
  it('propagates the authenticated actor and separates preview from save', async () => {
    const rows = [{ orderId: 42, trackingNumber: 'PQ123456789ES' }];
    await request(app.getHttpServer()).post('/api/admin/orders/tracking-bulk/assign').set('x-fixture-role', 'SUPERADMIN').send({ rows, preview: true }).expect(201);
    expect(admin.assignTrackingBulk).toHaveBeenCalledWith(rows, true, 7);
  });
  it('rejects an unbounded/empty batch, missing preview or caller-supplied actor', async () => {
    for (const body of [{ rows: [], preview: true }, { rows: Array(101).fill({}), preview: true }, { rows: [{}] }, { rows: [{}], preview: true, actorId: 999 }])
      await request(app.getHttpServer()).post('/api/admin/orders/tracking-bulk/assign').set('x-fixture-role', 'SUPERADMIN').send(body).expect(400);
    expect(admin.assignTrackingBulk).not.toHaveBeenCalled();
  });
});
