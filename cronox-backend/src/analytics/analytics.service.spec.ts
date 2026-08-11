import { BadRequestException } from '@nestjs/common';
import { CustomerActivityEventType, Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestAnalyticsEventsDto } from './dto/analytics-event.dto';

const consent = encodeURIComponent(JSON.stringify({
  necessary: true,
  analytics: true,
  consentVersion: '2',
  timestamp: new Date().toISOString(),
}));

const request = (granted = true) => ({
  cookies: granted
    ? { cronox_cookie_consent: decodeURIComponent(consent) }
    : {},
}) as any;

const event = (overrides: Record<string, unknown> = {}) => ({
  clientEventId: '3118ef15-8349-4704-8348-75952f12b983',
  eventType: CustomerActivityEventType.PRODUCT_VIEWED,
  productId: 12,
  ...overrides,
});

describe('AnalyticsService privacy and session boundaries', () => {
  let prisma: any;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ analyticsConsentStatus: null, analyticsFirstGrantedAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      analyticsSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        update: jest.fn().mockResolvedValue({}),
      },
      customerActivityEvent: { create: jest.fn().mockResolvedValue({}) },
      product: { count: jest.fn().mockResolvedValue(1) },
      category: { count: jest.fn().mockResolvedValue(1) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    service = new AnalyticsService(prisma);
  });

  it('records nothing before analytics consent', async () => {
    const result = await service.ingest(7, request(false), {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      events: [event()] as any,
    });

    expect(result).toEqual({ accepted: 0, reason: 'ANALYTICS_CONSENT_REQUIRED' });
    expect(prisma.customerActivityEvent.create).not.toHaveBeenCalled();
    expect(prisma.analyticsSession.create).not.toHaveBeenCalled();
  });

  it('uses the authenticated user argument and a structured allowlisted event', async () => {
    const result = await service.ingest(7, request(), {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      events: [event()] as any,
    });

    expect(result.accepted).toBe(1);
    expect(prisma.customerActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        productId: 12,
        eventType: CustomerActivityEventType.PRODUCT_VIEWED,
      }),
    });
    expect(prisma.customerActivityEvent.create.mock.calls[0][0].data).not.toHaveProperty('metadata');
  });

  it('rejects a session already owned by another account', async () => {
    prisma.analyticsSession.findUnique.mockResolvedValue({
      id: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      userId: 99,
      lastActivityAt: new Date(),
    });

    await expect(service.ingest(7, request(), {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      events: [event()] as any,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('redacts email addresses and phone-like values from search terms', async () => {
    await service.ingest(7, request(), {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      events: [event({
        eventType: CustomerActivityEventType.SEARCH_PERFORMED,
        productId: undefined,
        searchQuery: 'ana@example.com +34 600 123 123 camiseta',
        resultCount: 2,
      })] as any,
    });

    const stored = prisma.customerActivityEvent.create.mock.calls[0][0].data;
    expect(stored.searchQuery).toBe('[redacted] [redacted] camiseta');
    expect(stored.searchQuery).not.toContain('@');
  });

  it('treats a repeated client event id as idempotent', async () => {
    prisma.customerActivityEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }),
    );
    const result = await service.ingest(7, request(), {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      events: [event()] as any,
    });
    expect(result.accepted).toBe(0);
  });

  it('reuses one active visit and starts another after inactivity', async () => {
    const activeSession = {
      id: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      userId: 7,
      lastActivityAt: new Date(),
    };
    prisma.analyticsSession.findUnique.mockResolvedValueOnce(activeSession);
    const activeResult = await service.ingest(7, request(), {
      sessionId: activeSession.id,
      events: [event()] as any,
    });
    expect(activeResult.sessionId).toBe(activeSession.id);
    expect(prisma.analyticsSession.create).not.toHaveBeenCalled();

    prisma.analyticsSession.findUnique.mockResolvedValueOnce({
      ...activeSession,
      lastActivityAt: new Date(Date.now() - 31 * 60_000),
    });
    prisma.analyticsSession.findFirst.mockResolvedValueOnce(null);
    await service.ingest(7, request(), {
      sessionId: activeSession.id,
      events: [event({ clientEventId: '2ee9c6a6-791e-4847-b688-73806bc3096a' })] as any,
    });
    expect(prisma.analyticsSession.create).toHaveBeenCalledTimes(1);
  });

  it('distinguishes initial rejection from later withdrawal', async () => {
    await expect(service.syncConsent(7, { granted: false, version: '2' }, request(false)))
      .resolves.toEqual({ status: 'REJECTED' });
    prisma.user.findUnique.mockResolvedValue({ analyticsConsentStatus: 'ACTIVE', analyticsFirstGrantedAt: new Date() });
    await expect(service.syncConsent(7, { granted: false, version: '2' }, request(false)))
      .resolves.toEqual({ status: 'WITHDRAWN' });
  });

  it('rejects client identity, payment data and server-owned event types at DTO validation', async () => {
    const dto = plainToInstance(IngestAnalyticsEventsDto, {
      sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
      userId: 999,
      events: [{
        clientEventId: '3118ef15-8349-4704-8348-75952f12b983',
        eventType: CustomerActivityEventType.CHECKOUT_COMPLETED,
        paymentIntentId: 'pi_secret',
      }],
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'userId')).toBe(true);
    expect(errors.some((error) => error.property === 'events')).toBe(true);
  });
});
