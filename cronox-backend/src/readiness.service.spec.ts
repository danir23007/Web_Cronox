import { ReadinessService } from './readiness.service';

describe('bounded readiness, separate from liveness', () => {
  afterEach(() => jest.useRealTimers());

  it('coalesces probes, caches briefly, times out and never piles queries behind a stalled one', async () => {
    jest.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const prisma = {
      $queryRaw: jest.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    };
    const service = new ReadinessService(prisma as never);
    const waiting = Array.from({ length: 30 }, () => service.check());
    await jest.advanceTimersByTimeAsync(1000);
    expect(await Promise.all(waiting)).toEqual(Array(30).fill(false));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await service.check()).toBe(false);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    resolve([{ value: 1 }]);
    await jest.advanceTimersByTimeAsync(0);
    prisma.$queryRaw.mockResolvedValueOnce([] as never);
    expect(await service.check()).toBe(true);
    expect(await service.check()).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
