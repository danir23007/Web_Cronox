import { VisitorHistoryService, isPublicVisitPath } from './visitor-history.service';
import { PublicVisitorController, AdminVisitorController } from './visitor-history.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

describe('Visitor history boundaries', () => {
  it('only accepts known public pages without query/fragment data', () => {
    for (const path of ['/', '/tienda', '/producto/test', '/gallery.html', '/cuenta']) expect(isPublicVisitPath(path)).toBe(true);
    for (const path of ['/api/me', '/health', '/admin.html', '/admin/users', '/assets/api.js', '/?userId=1']) expect(isPublicVisitPath(path)).toBe(false);
  });
  it('requires existing analytics consent and never retains IPs/tokens/browser UUIDs', async () => {
    const db = { $executeRaw: jest.fn() };
    const service = new VisitorHistoryService(db as never);
    const browser = 'c01e9d8a-835c-4a64-864a-53e8da6dc1ed';
    expect(await service.record({ cookies:{} } as never, '/', browser)).toEqual({accepted:false});
    expect(db.$executeRaw).not.toHaveBeenCalled();
    const req = {cookies:{cronox_cookie_consent:JSON.stringify({version:'2',analytics:true})},user:{id:8},ip:'127.0.0.1'};
    expect(await service.record(req as never,'/',browser,new Date('2026-03-29T22:00:00Z'))).toMatchObject({day:'2026-03-30',category:'authenticated'});
    const values = db.$executeRaw.mock.calls[0].slice(1);
    expect(values).toContain(8); expect(values).not.toContain(browser); expect(values).not.toContain(req.ip);
  });
  it('rejects tampered identities, unresolved refresh sessions and classification races', () => {
    const service = { record:jest.fn() };
    const controller = new PublicVisitorController(service as never);
    const dto = {path:'/',browserId:'browser',expectedCategory:'anonymous'};
    expect(() => controller.record({body:{...dto,userId:1},cookies:{}} as never,dto)).toThrow('UNEXPECTED_VISIT_FIELDS');
    expect(() => controller.record({body:dto,cookies:{refresh_token:'pending'}} as never,dto)).toThrow('SESSION_RESOLUTION_REQUIRED');
    expect(() => controller.record({body:dto,cookies:{},user:{id:1}} as never,dto)).toThrow('SESSION_CHANGED_RETRY');
    expect(() => controller.record({body:dto,cookies:{},get:() => 'https://cronox.es/admin.html'} as never,dto)).toThrow('PUBLIC_PAGE_REQUIRED');
    expect(service.record).not.toHaveBeenCalled();
  });
  it('protects every admin report/detail with verified authentication and existing roles', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA,AdminVisitorController)).toEqual([JwtAuthGuard,AdminGuard]);
  });
  it('represents unavailable days with null and recorded empty days with zero', async () => {
    const tx = { $queryRaw:jest.fn().mockResolvedValueOnce([{startedAt:new Date('2026-03-29T12:00:00Z')}]).mockResolvedValueOnce([]) };
    const db = { $transaction: (work: (tx: unknown) => unknown) => work(tx) };
    const result = await new VisitorHistoryService(db as never).report('2026-03-28','2026-03-30');
    expect(result.buckets).toEqual([
      {day:'2026-03-28',authenticated:null,anonymous:null},
      {day:'2026-03-29',authenticated:0,anonymous:0},
      {day:'2026-03-30',authenticated:0,anonymous:0},
    ]);
  });
});
