import { KeyScreenService } from './key-screen.service';

describe('public gate query coalescing', () => {
  afterEach(() => jest.useRealTimers());
  it('shares a slow read and coalesces failures without opening an unknown gate', async () => {
    jest.useFakeTimers();
    let reject!: (e: Error) => void;
    const db = {
      keyScreenSettings: {
        findUnique: jest.fn(
          () =>
            new Promise((_r, fail) => {
              reject = fail;
            }),
        ),
      },
    };
    const gate = new KeyScreenService(db as never, {} as never, {} as never);
    const waiting = Array.from({ length: 20 }, () =>
      gate.shouldGatePublicHtml(),
    );
    expect(db.keyScreenSettings.findUnique).toHaveBeenCalledTimes(1);
    reject(new Error('unavailable'));
    expect(await Promise.all(waiting)).toEqual(Array(20).fill(true));
    expect(await gate.shouldGatePublicHtml()).toBe(true);
    expect(db.keyScreenSettings.findUnique).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1001);
    db.keyScreenSettings.findUnique.mockResolvedValueOnce(null as never);
    expect(await gate.shouldGatePublicHtml()).toBe(false);
  });

  it('does not install an old pending read after an admin invalidation', async () => {
    let resolve!: (v: unknown) => void;
    const db = {
      keyScreenSettings: {
        findUnique: jest
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise((r) => {
                resolve = r;
              }),
          )
          .mockResolvedValue(null),
      },
    };
    const gate = new KeyScreenService(db as never, {} as never, {} as never);
    const old = gate.shouldGatePublicHtml();
    gate.invalidateGateCache();
    resolve({
      enabled: true,
      activeScreen: { mode: 'PREREGISTRATION', mediaAssetId: 'old' },
    });
    expect(await old).toBe(false);
    expect(db.keyScreenSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});
