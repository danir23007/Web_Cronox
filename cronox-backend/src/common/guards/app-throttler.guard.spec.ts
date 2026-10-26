import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppThrottlerGuard, requestNetwork } from './app-throttler.guard';

class InspectGuard extends AppThrottlerGuard {
  identity(request: any) {
    return this.getTracker(request);
  }
  key(context: any, tracker: string) {
    return this.generateKey(context, tracker, 'default');
  }
}

describe('storefront quota identity', () => {
  const guard = new InspectGuard([], {} as any, new Reflector());
  const request = {
    path: '/api/cart/items',
    socket: { remoteAddress: '198.51.100.2' },
    headers: {},
    cookies: {},
  };
  it('ignores forged forwarding headers from direct remote clients', () => {
    expect(
      requestNetwork({
        ...request,
        headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' },
      }),
    ).toBe('198.51.100.2');
    expect(
      requestNetwork({
        ...request,
        socket: { remoteAddress: '::ffff:127.0.0.1' },
        headers: { 'x-real-ip': '203.0.113.2' },
      }),
    ).toBe('203.0.113.2');
    expect(
      requestNetwork({
        ...request,
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-real-ip': 'bad, proxy' },
      }),
    ).toBe('127.0.0.1');
    expect(
      requestNetwork({ ...request, ips: ['203.0.113.4'], ip: '203.0.113.4' }),
    ).toBe('203.0.113.4');
  });
  it('normalizes email quotas without applying body email to unrelated routes', async () => {
    expect(
      await guard.identity({
        ...request,
        path: '/api/auth/login',
        body: { email: 'Person@Example.test ' },
      }),
    ).toBe('email:person@example.test');
    expect(
      await guard.identity({
        ...request,
        body: { email: 'person@example.test' },
      }),
    ).toBe('network:198.51.100.2');
  });
  it('requires a valid signature before using an account quota', async () => {
    const token = new JwtService().sign(
      { sub: 17, type: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' },
    );
    expect(
      await guard.identity({
        ...request,
        headers: { authorization: `Bearer ${token}` },
      }),
    ).toBe('user:17');
    expect(
      await guard.identity({
        ...request,
        headers: { authorization: `Bearer ${token}invalid` },
      }),
    ).toBe('network:198.51.100.2');
  });
  it('hashes private identifiers and isolates operations', () => {
    const context = {
      getClass: () => ({ name: 'AuthController' }),
      getHandler: () => ({ name: 'login' }),
    };
    const key = guard.key(context, 'email:person@example.test');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(
      guard.key(
        { ...context, getHandler: () => ({ name: 'register' }) },
        'email:person@example.test',
      ),
    ).not.toBe(key);
    expect(guard.key(context, 'email:other@example.test')).not.toBe(key);
  });
});
