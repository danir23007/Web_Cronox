import { ExpiringThrottlerStorage } from './expiring-throttler.storage';

describe('expiring per-operation/IP limits', () => {
  let storage: ExpiringThrottlerStorage;
  beforeEach(() => {
    jest.useFakeTimers();
    storage = new ExpiringThrottlerStorage();
  });
  afterEach(() => {
    storage.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('limits repeated attempts, preserves other IP/operations and recovers without extending blocks', async () => {
    const hit = (key: string) =>
      storage.increment(key, 60000, 2, 60000, 'default');
    expect((await hit('login:A')).isBlocked).toBe(false);
    expect((await hit('login:A')).isBlocked).toBe(false);
    expect((await hit('login:A')).isBlocked).toBe(true);
    expect((await hit('products:A')).isBlocked).toBe(false);
    expect((await hit('login:B')).isBlocked).toBe(false);
    await jest.advanceTimersByTimeAsync(30000);
    expect((await hit('login:A')).timeToBlockExpire).toBe(30);
    await jest.advanceTimersByTimeAsync(30001);
    expect((await hit('login:A')).isBlocked).toBe(false);
  });

  it('removes expired identities with one sweep, not one timer per hit', async () => {
    for (let i = 0; i < 100; i++)
      await storage.increment(`ip:${i}`, 1000, 10, 1000, 'default');
    expect(storage.size).toBe(100);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(10001);
    expect(storage.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('has a sliding window and does not reset another key when a block expires', async () => {
    const hit = (key: string) =>
      storage.increment(key, 10000, 2, 2000, 'default');
    await hit('A');
    await hit('A');
    await hit('A');
    await hit('B');
    await jest.advanceTimersByTimeAsync(2001);
    expect((await hit('A')).isBlocked).toBe(false);
    expect((await hit('B')).totalHits).toBe(2);
    expect((await hit('B')).isBlocked).toBe(true);
  });

  it('is deliberately per process; separate instances do not claim a shared limit', async () => {
    const second = new ExpiringThrottlerStorage();
    try {
      await storage.increment('same', 1000, 1, 1000, 'default');
      expect(
        (await storage.increment('same', 1000, 1, 1000, 'default')).isBlocked,
      ).toBe(true);
      expect(
        (await second.increment('same', 1000, 1, 1000, 'default')).isBlocked,
      ).toBe(false);
    } finally {
      second.onApplicationShutdown();
    }
  });
});
