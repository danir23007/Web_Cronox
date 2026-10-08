import { ConflictException, ExecutionContext } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { firstValueFrom, from } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserIdentityGuard } from './user-identity.guard';
import { userNumberingMiddleware, UserNumberingCompletion } from './user-numbering.middleware';
import { AdminUsersController } from '../admin/users/admin-users.controller';
import { AdminManualPurchasesController } from '../admin/manual-purchases/admin-manual-purchases.controller';
import { AdminNotesController } from '../admin/notes/admin-notes.controller';
import { AdminOrdersController } from '../admin/orders/admin-orders.controller';
import { AdminExportsController } from '../admin/exports/admin-exports.controller';

const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const context = (request: unknown) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;

describe('Consecutive account numbers retain a separate immutable identity', () => {
  const findUnique = jest.fn();
  const guard = new UserIdentityGuard({ user: { findUnique } } as unknown as PrismaService);
  beforeEach(() => { findUnique.mockReset().mockResolvedValue({ identityUid: uid }); });
  it.each([undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])('rejects missing/stale identity %s even when the reused ID exists', async header => {
    await expect(guard.canActivate(context({ path: '/api/admin/users/2', params: { id: '2' }, headers: { 'x-cronox-user-identity': header } }))).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    { path: '/api/admin/users/2/role', params: { id: '2' } },
    { path: '/api/admin/orders', query: { userId: '2' } },
    { path: '/api/admin/notes', body: { targetType: 'user', targetId: '2' } },
    { path: '/api/admin/exports/usuarios', query: { userId: '2' } },
  ])('validates the account identity for $path', async request => {
    await expect(guard.canActivate(context({ ...request, headers: { 'x-cronox-user-identity': uid } }))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 2 }, select: { identityUid: true } });
  });
  it('does not interpret an order, note, or unfiltered list ID as an account', async () => {
    for (const path of ['/api/admin/orders/2', '/api/admin/notes/2', '/api/admin/users']) {
      expect(await guard.canActivate(context({ path, params: { id: '2' }, headers: {} }))).toBe(true);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
  it.each([AdminUsersController, AdminManualPurchasesController, AdminNotesController, AdminOrdersController, AdminExportsController])('guards %p', controller => {
    expect(Reflect.getMetadata('__guards__', controller)).toContain(UserIdentityGuard);
  });
});

describe('Request numbering gate', () => {
  it('keeps the shared gate after disconnect until the asynchronous handler finishes, and releases once', async () => {
    const query = jest.fn().mockResolvedValue({});
    const release = jest.fn();
    const pool = { connect: jest.fn().mockResolvedValue({ query, release }) };
    const req: any = { path: '/api/me' };
    const res: any = Object.assign(new EventEmitter(), { destroyed: false });
    let admitted!: () => void;
    const admittedPromise = new Promise<void>(resolve => { admitted = resolve; });
    userNumberingMiddleware(pool as any)(req, res, admitted);
    await admittedPromise;
    let finish!: () => void;
    const work = new Promise<void>(resolve => { finish = resolve; });
    const completion = firstValueFrom(new UserNumberingCompletion().intercept(context(req), { handle: () => from(work) }));
    res.emit('close');
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    finish(); await completion;
    await Promise.resolve();
    res.emit('finish'); req.releaseNumbering();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('unlock_shared');
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('releases a disconnected request before a handler and refuses to start it later', async () => {
    const query = jest.fn().mockResolvedValue({}); const release = jest.fn();
    const req: any = { path: '/api/me' };
    const res: any = Object.assign(new EventEmitter(), { destroyed: true });
    const next = jest.fn();
    userNumberingMiddleware({ connect: async () => ({ query, release }) } as any)(req, res, next);
    for(let i=0;i<5;i++)await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => new UserNumberingCompletion().intercept(context(req), { handle: jest.fn() })).toThrow('Request disconnected');
  });
});
