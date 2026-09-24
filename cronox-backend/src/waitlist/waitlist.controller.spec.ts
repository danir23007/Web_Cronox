import { Test } from '@nestjs/testing';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CsrfProtectionGuard } from '../common/guards/csrf-protection.guard';
import {
  AdminWaitlistController,
  WaitlistController,
} from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

describe('Waitlist HTTP authorization/validation', () => {
  let app: INestApplication;
  const service = {
    report: jest.fn().mockResolvedValue({ rows: [] }),
    state: jest.fn().mockResolvedValue({ subscription: null }),
    join: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({}),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WaitlistController, AdminWaitlistController],
      providers: [
        AdminGuard,
        RolesGuard,
        { provide: WaitlistService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (!role) throw new UnauthorizedException();
          req.user = { id: 42, role };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use((req: any, _res: any, next: () => void) => {
      req.cookies = req.headers.cookie
        ? { cronox_csrf_token: 'test-csrf' }
        : {};
      next();
    });
    app.useGlobalGuards(new CsrfProtectionGuard());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('requires authentication for customer and admin endpoints', async () => {
    await request(app.getHttpServer()).get('/api/waitlist/1').expect(401);
    await request(app.getHttpServer()).get('/api/admin/waitlist').expect(401);
  });
  it.each(['USER', 'FRIEND'])(
    'forbids %s from admin reporting',
    async (role) => {
      await request(app.getHttpServer())
        .get('/api/admin/waitlist')
        .set('x-test-role', role)
        .expect(403);
    },
  );
  it.each(['ADMIN', 'SUPERADMIN'])(
    'allows %s reporting without customer details',
    async (role) => {
      await request(app.getHttpServer())
        .get('/api/admin/waitlist?page=2&size=M&status=QUEUED')
        .set('x-test-role', role)
        .expect(200);
      expect(service.report).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, size: 'M', status: 'QUEUED' }),
      );
    },
  );
  it.each(['page=0', 'page=1.1', 'status=UNKNOWN', 'size=BAD', 'userId=2'])(
    'rejects invalid query %s',
    async (query) => {
      await request(app.getHttpServer())
        .get(`/api/admin/waitlist?${query}`)
        .set('x-test-role', 'ADMIN')
        .expect(400);
    },
  );
  it('never accepts a customer identity from the URL/body and enforces CSRF', async () => {
    await request(app.getHttpServer())
      .post('/api/waitlist/7')
      .set('x-test-role', 'USER')
      .send({ userId: 999 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/waitlist/7')
      .set('x-test-role', 'USER')
      .set('Origin', process.env.FRONTEND_URL!)
      .set('Cookie', 'cronox_csrf_token=test-csrf')
      .set('X-CSRF-Token', 'test-csrf')
      .send({ userId: 999 })
      .expect(201);
    expect(service.join).toHaveBeenLastCalledWith(42, 7);
    await request(app.getHttpServer())
      .get('/api/waitlist/not-a-number')
      .set('x-test-role', 'USER')
      .expect(400);
  });
});
