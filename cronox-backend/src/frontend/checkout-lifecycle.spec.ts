import path from 'node:path';

describe('checkout frontend lifecycle coordinator', () => {
  const coordinatorModule = jest.requireActual<{
    createCoordinator: () => {
      current: () => number;
      invalidate: () => number;
      isCurrent: (revision: number) => boolean;
      enqueue: (
        revision: number,
        task: (isCurrent: () => boolean) => Promise<boolean>,
      ) => Promise<boolean>;
    };
    pollUntilProcessed: (options: {
      fetchStatus: () => Promise<Record<string, unknown>>;
      onProcessed: (status: Record<string, unknown>) => Promise<void>;
      shouldContinue?: () => boolean;
      delay?: () => Promise<void>;
      intervalMs?: number;
      maxAttempts?: number;
    }) => Promise<{
      outcome: string;
      status: Record<string, unknown> | null;
    }>;
  }>(
    path.resolve(
      __dirname,
      '../../../cronox-front/assets/checkout-lifecycle.js',
    ),
  );

  it('serializes rapid changes and prevents a stale response from committing', async () => {
    const coordinator = coordinatorModule.createCoordinator();
    const commits: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstRevision = coordinator.invalidate();
    const first = coordinator.enqueue(firstRevision, async (isCurrent) => {
      await firstGate;
      if (!isCurrent()) return false;
      commits.push('STANDARD');
      return true;
    });

    const secondRevision = coordinator.invalidate();
    const second = coordinator.enqueue(secondRevision, (isCurrent) => {
      if (!isCurrent()) return Promise.resolve(false);
      commits.push('EXPRESS');
      return Promise.resolve(true);
    });

    releaseFirst();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(commits).toEqual(['EXPRESS']);
    expect(coordinator.isCurrent(firstRevision)).toBe(false);
    expect(coordinator.isCurrent(secondRevision)).toBe(true);
  });

  it('polls a delayed succeeded webhook and commits only after order processing', async () => {
    const fetchStatus = jest
      .fn()
      .mockResolvedValueOnce({
        found: false,
        isProcessed: false,
        paymentPending: true,
      })
      .mockResolvedValueOnce({
        found: true,
        isProcessed: true,
        orderId: 16,
      });
    const onProcessed = jest.fn().mockResolvedValue(undefined);
    const delay = jest.fn().mockResolvedValue(undefined);

    await expect(
      coordinatorModule.pollUntilProcessed({
        fetchStatus,
        onProcessed,
        delay,
        maxAttempts: 3,
      }),
    ).resolves.toEqual({
      outcome: 'processed',
      status: { found: true, isProcessed: true, orderId: 16 },
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledTimes(1);
  });
});
