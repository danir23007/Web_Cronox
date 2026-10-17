import { ExecutionContext, INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HistorialService } from '../historial/historial.service';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';

// The member composition shares the book's complete purchase totals. It must
// not accidentally reuse an analytics exclusion or a paginated orders list.
describe('Member composition: existing purchase-statistics contract', () => {
  function setup() {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 7, circleLevel: 5, createdAt: new Date('2020-01-01') }) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const circle = {
      ensureCircleByNetSpent: jest.fn(),
      maybePromoteRequestedCircle: jest.fn(),
      getNetSpent: jest.fn().mockResolvedValue({ toString: () => '0' }),
      getPromotionStatus: jest.fn().mockResolvedValue('none'),
    };
    const historial = new HistorialService(prisma as any);
    const calculate = jest.spyOn(historial, 'calculatePurchaseStats');
    const service = new MembershipService(prisma as any, {} as any, historial, circle as any);
    return { prisma, circle, calculate, service };
  }

  it('uses all of the authenticated member purchases, including manual purchases excluded only from analytics', async () => {
    const { prisma, calculate, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      { status: OrderStatus.PAID, source: 'WEB', items: [{ productId: 10, quantity: 2 }] },
      { status: OrderStatus.DELIVERED, source: 'IN_PERSON_ADMIN', excludedFromStatistics: true, items: [{ productId: 10, quantity: 1 }] },
      { status: OrderStatus.DISPUTED, items: [{ productId: 20, quantity: 4 }, { productId: 99, quantity: 0 }] },
      { status: OrderStatus.REFUNDED, items: [{ productId: 30, quantity: 5 }] },
    ]);

    await expect(service.getMyStats(7)).resolves.toMatchObject({
      pedidosRealizados: 4,
      articulosAdquiridos: 7,
      productosDiferentes: 2,
    });
    expect(calculate).toHaveBeenCalledWith(7, prisma, false);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        userId: 7,
        status: { in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED,
          OrderStatus.DELIVERED, OrderStatus.DISPUTED, OrderStatus.REFUNDED] },
      },
      select: { status: true, items: { select: { productId: true, quantity: true } } },
    });
  });

  it('returns actual zeroes for a member with no recorded purchases', async () => {
    const { service } = setup();
    await expect(service.getMyStats(7)).resolves.toMatchObject({
      pedidosRealizados: 0, articulosAdquiridos: 0, productosDiferentes: 0,
    });
  });

  it('propagates a history failure instead of turning unavailable totals into zeroes', async () => {
    const { prisma, service } = setup();
    prisma.order.findMany.mockRejectedValue(new Error('History unavailable'));
    await expect(service.getMyStats(7)).rejects.toThrow('History unavailable');
  });

  it('does not query another identity or purchase history when the member no longer exists', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getMyStats(7)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 7 }, select: { id: true, circleLevel: true, createdAt: true },
    });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});

describe('Member composition: existing authenticated statistics route', () => {
  let app: INestApplication;
  const getMyStats = jest.fn();
  const getMyAccreditation = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MembershipController],
      providers: [{ provide: MembershipService, useValue: { getMyStats, getMyAccreditation } }],
    }).overrideGuard(JwtAuthGuard).useValue({
      // Authentication is simulated here; the real route and CurrentUser
      // decorator must still choose the authenticated identity over input.
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        if (req.headers.authorization !== 'Test member-session') throw new UnauthorizedException();
        req.user = { id: 7 };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  beforeEach(() => {
    getMyStats.mockReset();
    getMyStats.mockResolvedValue({ pedidosRealizados: 0, articulosAdquiridos: 0, productosDiferentes: 0 });
    getMyAccreditation.mockReset();
    getMyAccreditation.mockResolvedValue({ registrationNumber: 7, visibleId: 'immutable-identity', qrPayload: 'CRX:1:unchanged' });
  });
  afterAll(async () => { await app?.close(); });

  it('passes the authenticated identity and ignores a forged userId query', async () => {
    await request(app.getHttpServer()).get('/api/membership/me/stats?userId=999')
      .set('Authorization', 'Test member-session').expect(200)
      .expect({ pedidosRealizados: 0, articulosAdquiridos: 0, productosDiferentes: 0 });
    expect(getMyStats).toHaveBeenCalledWith(7);
  });

  it('does not provide statistics when the route guard rejects the session', async () => {
    await request(app.getHttpServer()).get('/api/membership/me/stats?userId=7').expect(401);
    expect(getMyStats).not.toHaveBeenCalled();
  });

  it('returns only the authenticated member number, ignoring forged identity and number parameters', async () => {
    await request(app.getHttpServer()).get('/api/membership/me/accreditation?userId=999&registrationNumber=999&identityUid=other')
      .set('Authorization', 'Test member-session').expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect({ registrationNumber: 7, visibleId: 'immutable-identity', qrPayload: 'CRX:1:unchanged' });
    expect(getMyAccreditation).toHaveBeenCalledWith(7);
  });

  it('does not expose the display number or QR without an accepted session', async () => {
    await request(app.getHttpServer()).get('/api/membership/me/accreditation?userId=7').expect(401);
    expect(getMyAccreditation).not.toHaveBeenCalled();
  });
});
