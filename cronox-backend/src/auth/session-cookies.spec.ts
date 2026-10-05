import { UnauthorizedException } from '@nestjs/common';
import { clearFailedSession } from './session-cookies';

describe('terminal authentication versus temporary dependency failure', () => {
  it('keeps both cookies for unavailable identity storage, including refresh', () => {
    const res = { clearCookie: jest.fn() };
    clearFailedSession(res as never, new Error('database unavailable'), true);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
  it('still clears rejected refresh credentials and revoked sessions', () => {
    const res = { clearCookie: jest.fn() };
    clearFailedSession(res as never, undefined, true);
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    res.clearCookie.mockClear();
    clearFailedSession(
      res as never,
      new UnauthorizedException({ code: 'SESSION_INVALID' }),
    );
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });
});
