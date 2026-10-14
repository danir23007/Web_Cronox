import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminOrdersController } from '../admin/orders/admin-orders.controller';
import { AdminOrdersService } from '../admin/orders/admin-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingLabelsService } from './labels.service';
import { ShippingTrackingModule } from './shipping-tracking.module';
import { MailTransportFactory } from '../email/mail-transport.factory';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { UserNumberingGate } from '../users/user-numbering-gate.module';
import { TrackingService } from './tracking.service';

describe('Private label HTTP boundary', () => {
  let app: INestApplication;
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
  const labels = {
    upload: jest.fn().mockResolvedValue({ fileName: 'label.pdf', size: pdf.length, trackingRevision: 2 }),
    download: jest.fn().mockResolvedValue({ buffer: pdf, fileName: 'label.pdf' }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminOrdersController],
      providers: [
        { provide: AdminOrdersService, useValue: {} },
        { provide: ShippingLabelsService, useValue: labels },
        { provide: PrismaService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: any) {
      const req = context.switchToHttp().getRequest();
      if (!req.headers['x-fixture-role']) throw new UnauthorizedException();
      req.user = { id: 7, role: req.headers['x-fixture-role'] };
      return true;
    } }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('requires authentication and rejects lower roles before processing a label', async () => {
    await request(app.getHttpServer()).get('/api/admin/orders/9/label').expect(401);
    for (const role of ['USER', 'FRIEND', 'ADMIN']) {
      await request(app.getHttpServer()).get('/api/admin/orders/9/label').set('x-fixture-role', role).expect(403);
      await request(app.getHttpServer()).post('/api/admin/orders/9/label').set('x-fixture-role', role)
        .field('revision', '2').attach('file', pdf, { filename: 'label.pdf', contentType: 'application/pdf' }).expect(403);
    }
    expect(labels.download).not.toHaveBeenCalled();
    expect(labels.upload).not.toHaveBeenCalled();
  });

  it('accepts a single PDF and revision only after Super Admin authorization', async () => {
    await request(app.getHttpServer()).post('/api/admin/orders/9/label').set('x-fixture-role', 'SUPERADMIN')
      .field('revision', '2').attach('file', pdf, { filename: 'label.pdf', contentType: 'application/pdf' }).expect(201);
    expect(labels.upload).toHaveBeenCalledWith(9, 2, 7, expect.objectContaining({ buffer: pdf, mimetype: 'application/pdf' }));
  });

  it('rejects missing revisions, non-PDF uploads and unexpected multipart fields', async () => {
    await request(app.getHttpServer()).post('/api/admin/orders/9/label').set('x-fixture-role', 'SUPERADMIN')
      .attach('file', pdf, { filename: 'label.pdf', contentType: 'application/pdf' }).expect(400);
    await request(app.getHttpServer()).post('/api/admin/orders/9/label').set('x-fixture-role', 'SUPERADMIN')
      .field('revision', '2').attach('file', pdf, { filename: 'label.html', contentType: 'text/html' }).expect(400);
    await request(app.getHttpServer()).post('/api/admin/orders/9/label').set('x-fixture-role', 'SUPERADMIN')
      .field('revision', '2').field('unexpected', 'not-accepted')
      .attach('file', pdf, { filename: 'label.pdf', contentType: 'application/pdf' }).expect(400);
    expect(labels.upload).not.toHaveBeenCalled();
  });

  it('downloads as a private attachment with no inline execution or public cache', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/orders/9/label')
      .set('x-fixture-role', 'SUPERADMIN').expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toBe('attachment; filename="pedido-9-etiqueta.pdf"');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toEqual(pdf);
  });
});

describe('ShippingTrackingModule dependency wiring', () => {
  it('boots with background work disabled without connecting to DB, SMTP or carrier', async () => {
    const previous = { enabled: process.env.CORREOS_TRACKING_ENABLED, jobs: process.env.BACKGROUND_JOBS_ENABLED };
    process.env.CORREOS_TRACKING_ENABLED = 'false';
    process.env.BACKGROUND_JOBS_ENABLED = 'false';
    const transport = { sendMail: jest.fn() };
    const numbering = { shared: jest.fn() };
    const external = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('EXTERNAL_HTTP_NOT_ALLOWED'));
    let module: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | undefined;
    try {
      module = await Test.createTestingModule({ imports: [ShippingTrackingModule] })
        .overrideProvider(PrismaService).useValue({})
        .overrideProvider(MailTransportFactory).useValue(transport)
        .overrideProvider(SupabaseStorageService).useValue({})
        .overrideProvider(UserNumberingGate).useValue(numbering)
        .compile();
      await module.init();
      expect(module.get(ShippingLabelsService)).toBeDefined();
      expect(module.get(TrackingService)).toBeDefined();
      expect(transport.sendMail).not.toHaveBeenCalled();
      expect(numbering.shared).not.toHaveBeenCalled();
      expect(external).not.toHaveBeenCalled();
    } finally {
      await module?.close();
      external.mockRestore();
      if (previous.enabled === undefined) delete process.env.CORREOS_TRACKING_ENABLED;
      else process.env.CORREOS_TRACKING_ENABLED = previous.enabled;
      if (previous.jobs === undefined) delete process.env.BACKGROUND_JOBS_ENABLED;
      else process.env.BACKGROUND_JOBS_ENABLED = previous.jobs;
    }
  });
});
