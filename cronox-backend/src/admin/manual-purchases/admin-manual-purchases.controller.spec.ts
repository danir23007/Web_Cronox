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
  const service = { getOptions: jest.fn(), create: jest.fn(), void: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    service.getOptions.mockResolvedValue({ products: [] });
    service.create.mockResolvedValue({ created: true, order: { id: 1 } });
    const module = await Test.createTestingModule({
      controllers: [AdminManualPurchasesController, AdminManualPurchaseCorrectionsController],
      providers: [AdminGuard, RolesGuard, SuperAdminGuard, { provide: AdminManualPurchasesService, useValue: service }],
    }).overrideGuard(JwtAuthGuard).useClass(HeaderAuthGuard).compile();
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

  it('validates input and forwards the idempotency key', async () => {
    await request(app.getHttpServer()).post('/api/admin/users/7/in-person-purchases').set('x-test-role', Role.SUPERADMIN).set('Idempotency-Key', 'manual-purchase-123456').send({
      items: [{ variantId: 4, quantity: 3 }], paymentMethod: 'CASH', stockHandling: 'DEDUCT_NOW', purchasedAt: '2026-09-25T10:00:00.000Z',
    }).expect(201);
    expect(service.create).toHaveBeenCalledWith(7, 99, 'manual-purchase-123456', expect.objectContaining({ items: [{ variantId: 4, quantity: 3 }] }));
  });
});
