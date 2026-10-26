import { UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('optional authentication after the short access cookie expires', () => {
  const guard = new OptionalJwtAuthGuard();
  const context = (cookies: Record<string, string>) => ({ switchToHttp: () => ({
    getRequest: () => ({ cookies, headers: {} }), getResponse: () => ({ clearCookie: jest.fn() }),
  }) }) as never;
  it('requests refresh rather than silently treating a remembered customer as a guest', () => {
    expect(() => guard.handleRequest(null, false, null, context({ refresh_token: 'opaque' }))).toThrow(UnauthorizedException);
  });
  it('continues to allow actual guests and authenticated customers', () => {
    expect(guard.handleRequest(null, false, null, context({}))).toBeUndefined();
    const user = { id: 7 };
    expect(guard.handleRequest(null, user as never, null, context({}))).toBe(user);
  });
});
