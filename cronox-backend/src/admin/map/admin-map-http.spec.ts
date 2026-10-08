import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminMapController } from './admin-map.controller';
import { AdminMapService } from './admin-map.service';

describe('Map HTTP authorization and validation', () => {
  let app: INestApplication;
  const service = {
    getReport: jest.fn(async (query) => ({ range: query, regions: [] })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminMapController],
      providers: [{ provide: AdminMapService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['x-test-role']) throw new UnauthorizedException();
          req.user = { role: req.headers['x-test-role'] };
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
  afterAll(async () => app.close());
  const url = '/admin/map?from=2026-10-01&to=2026-10-07';
  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
  });
  it.each(['USER', 'FRIEND'])(
    'rejects %s on summary and paginated detail',
    async (role) => {
      await request(app.getHttpServer())
        .get(url)
        .set('x-test-role', role)
        .expect(403);
      await request(app.getHttpServer())
        .get(url + '&region=13&page=2')
        .set('x-test-role', role)
        .expect(403);
    },
  );
  it.each(['ADMIN', 'SUPERADMIN'])(
    'admits the existing Finance role %s',
    async (role) => {
      const response = await request(app.getHttpServer())
        .get(url + '&region=18&page=2')
        .set('x-test-role', role)
        .expect(200);
      expect(response.body.range).toMatchObject({ region: '18', page: 2 });
    },
  );
  it.each(['page=-1', 'page=1.5', 'region=99', 'from=wrong', 'extra=value'])(
    'rejects invalid %s',
    async (parameter) => {
      const params = new URLSearchParams('from=2026-10-01&to=2026-10-07');
      const [key, value] = parameter.split('=');
      params.set(key, value);
      await request(app.getHttpServer())
        .get('/admin/map?' + params)
        .set('x-test-role', 'ADMIN')
        .expect(400);
    },
  );
});
