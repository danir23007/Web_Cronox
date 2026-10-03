import { AuthController } from '../auth/auth.controller';

describe('Server visitor bridge across access methods', () => {
  const user = { id: 7, role: 'FRIEND' };
  const result = { user, tokens: {} };
  const req = { cookies: {}, user: { id: 7 }, refreshToken: 'synthetic' };
  const res = { setHeader: jest.fn() };
  it.each(['login', 'register', 'launchLogin', 'newsletterLogin', 'refresh'])(
    '%s reconciles only the identity returned by the authenticated server service',
    async (method) => {
      const auth: any = {
        login: jest.fn().mockResolvedValue(result),
        register: jest.fn().mockResolvedValue(result),
        consumeLaunchLink: jest.fn().mockResolvedValue(result),
        consumeNewsletterLink: jest.fn().mockResolvedValue(result),
        refresh: jest.fn().mockResolvedValue(result),
        setAuthCookies: jest.fn(),
        mergeCartOnLogin: jest
          .fn()
          .mockResolvedValue({ merged: false, incidents: [] }),
        logCartMergeResult: jest.fn(),
        logCartMergeError: jest.fn(),
      };
      const visitors = { bridge: jest.fn() };
      const controller: any = new AuthController(auth, visitors as never);
      await controller[method](req, res, {
        token: 'synthetic',
        userId: 999,
        role: 'ADMIN',
      });
      expect(visitors.bridge).toHaveBeenCalledWith(req, user);
    },
  );
});
