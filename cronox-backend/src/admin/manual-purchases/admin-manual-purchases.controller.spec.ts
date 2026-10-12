import { UserIdentityGuard } from '../../users/user-identity.guard';
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminManualPurchaseCorrectionsController, AdminManualPurchasesController } from './admin-manual-purchases.controller';
import { AdminManualPurchasesService } from './admin-manual-purchases.service';

class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.headers['x-test-role']) throw new UnauthorizedException();
    req.user = { id: 99, role: req.headers['x-test-role'] };
    return true;
  }
}

describe('manual purchase permissions (HTTP)', () => {
  let app: INestApplication;
  const service = { getOptions: jest.fn(), create: jest.fn(), void: jest.fn(), setStatisticsExclusion: jest.fn(), getForEdit: jest.fn(), edit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    service.getOptions.mockResolvedValue({ products: [] });
    service.create.mockResolvedValue({ created: true, order: { id: 1 } });
    const module = await Test.createTestingModule({
      controllers: [AdminManualPurchasesController, AdminManualPurchaseCorrectionsController],
      providers: [AdminGuard, RolesGuard, SuperAdminGuard, { provide: AdminManualPurchasesService, useValue: service }],
    }).overrideGuard(JwtAuthGuard).useClass(HeaderAuthGuard).overrideGuard(UserIdentityGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterEach(async () => app.close());

  it('allows SUPERADMIN and rejects ADMIN', async () => {
    await request(app.getHttpServer()).get('/api/admin/users/7/in-person-purchase-options').set('x-test-role', Role.SUPERADMIN).expect(200);
    await request(app.getHttpServer()).get('/api/admin/users/7/in-person-purchase-options').set('x-test-role', Role.ADMIN).expect(403);
  });

  it('requires superadmin for a strict boolean exclusion and forwards the retry key', async () => {
    const route = '/api/admin/orders/7/statistics-exclusion';
    await request(app.getHttpServer()).post(route).send({ excludedFromStatistics: true }).expect(401);
    await request(app.getHttpServer()).post(route).set('x-test-role', Role.ADMIN).send({ excludedFromStatistics: true }).expect(403);
    for (const value of [null, 'true', 1]) await request(app.getHttpServer()).post(route).set('x-test-role', Role.SUPERADMIN).send({ excludedFromStatistics: value }).expect(400);
    await request(app.getHttpServer()).post(route).set('x-test-role', Role.SUPERADMIN).set('Idempotency-Key', 'statistics-choice-123456').send({ excludedFromStatistics: false }).expect(201);
    expect(service.setStatisticsExclusion).toHaveBeenCalledWith(7, 99, 'statistics-choice-123456', false);
  });

  it('validates input and forwards the idempotency key', async () => {
    await request(app.getHttpServer()).post('/api/admin/users/7/in-person-purchases').set('x-test-role', Role.SUPERADMIN).set('Idempotency-Key', 'manual-purchase-123456').send({
      items: [{ variantId: 4, quantity: 3 }], paymentMethod: 'CASH', stockHandling: 'DEDUCT_NOW', purchasedAt: '2026-09-25T10:00:00.000Z',
    }).expect(201);
    expect(service.create).toHaveBeenCalledWith(7, 99, 'manual-purchase-123456', expect.objectContaining({ items: [{ variantId: 4, quantity: 3 }] }));
  });
  it.each([null, -1, 1.5, '0', '', 'NaN', 1000000000000])('rejects present invalid cents through HTTP: %s', async (price) => {
    await request(app.getHttpServer()).post('/api/admin/users/7/in-person-purchases').set('x-test-role', Role.SUPERADMIN).send({
      items: [{ variantId: 4, quantity: 2, unitPriceCents: price }], paymentMethod: 'CASH', stockHandling: 'ALREADY_ADJUSTED',
    }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '', 'INVALID'])('rejects missing or invalid stock handling through HTTP: %s', async stockHandling => {
    const response = await request(app.getHttpServer()).post('/api/admin/users/7/in-person-purchases').set('x-test-role', Role.SUPERADMIN).send({
      items: [{ variantId: 4, quantity: 2, unitPriceCents: 1000 }], paymentMethod: 'CASH', stockHandling,
    }).expect(400);
    expect(response.body.message).toContain('Selecciona cómo se debe tratar el stock');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('accepts explicit zero cents', async () => {
    await request(app.getHttpServer()).post('/api/admin/users/7/in-person-purchases').set('x-test-role', Role.SUPERADMIN).send({
      items: [{ variantId: 4, quantity: 2, unitPriceCents: 0 }], paymentMethod: 'CASH', stockHandling: 'ALREADY_ADJUSTED',
    }).expect(201);
    expect(service.create.mock.calls[0][3].items[0].unitPriceCents).toBe(0);
  });

  const editPayload = { expectedVersion: 'a'.repeat(64), items: [{ itemId: 10, variantId: 4, quantity: 2, unitPriceCents: 2550 }],
    paymentMethod: 'CASH', purchasedAt: '2026-10-01T12:00:33.000Z', excludedFromStatistics: true, note: 'Edición' };
  const editRoute = '/api/admin/users/7/in-person-purchases/41';
  it('protects editing and reading with the same superadmin guards and forwards owner/version/retry key', async () => {
    await request(app.getHttpServer()).get(editRoute).expect(401);
    await request(app.getHttpServer()).get(editRoute).set('x-test-role', Role.ADMIN).expect(403);
    await request(app.getHttpServer()).patch(editRoute).set('x-test-role', Role.ADMIN).send(editPayload).expect(403);
    await request(app.getHttpServer()).get(editRoute).set('x-test-role', Role.SUPERADMIN).expect(200);
    expect(service.getForEdit).toHaveBeenCalledWith(7, 41);
    await request(app.getHttpServer()).patch(editRoute).set('x-test-role', Role.SUPERADMIN).set('Idempotency-Key', 'edit-purchase-key-123456').send(editPayload).expect(200);
    expect(service.edit).toHaveBeenCalledWith(7, 41, 99, 'edit-purchase-key-123456', expect.objectContaining(editPayload));
  });
  it.each([
    { stockHandling: 'ALREADY_ADJUSTED' }, { expectedVersion: '' }, { items: [] }, { purchasedAt: 'invalid' },
    { paymentMethod: 'STRIPE' }, { excludedFromStatistics: 'true' }, { items: [{ variantId: 4, quantity: 1 }] },
    { items: [{ itemId: null, variantId: 4, quantity: 1, unitPriceCents: 1 }] },
    { items: [{ variantId: 4, quantity: 0, unitPriceCents: 1 }] },
  ])('rejects invalid edit fields and changing the stock treatment: %s', async override => {
    await request(app.getHttpServer()).patch(editRoute).set('x-test-role', Role.SUPERADMIN).send({ ...editPayload, ...override }).expect(400);
    expect(service.edit).not.toHaveBeenCalled();
  });

});
