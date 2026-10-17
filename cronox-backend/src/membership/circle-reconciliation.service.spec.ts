import { CircleReconciliationService } from './circle-reconciliation.service';
import * as policy from './circle-policy';

describe('circle queue idle reads', () => {
  let prisma: any;
  let tx: any;
  let worker: CircleReconciliationService;
  let reconcile: jest.SpyInstance;
  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), circleReconciliationQueue: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = {
      circleReconciliationQueue: { findFirst: jest.fn() },
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    worker = new CircleReconciliationService(prisma);
    reconcile = jest.spyOn(policy, 'reconcileCircle2').mockResolvedValue({ changed: false, userId: 7, netSpendCents: null });
  });
  afterEach(() => { worker.onModuleDestroy(); jest.restoreAllMocks(); });

  it('does not open a transaction when the persistent queue is empty', async () => {
    prisma.circleReconciliationQueue.findFirst.mockResolvedValue(null);
    await expect(worker.drainQueue()).resolves.toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('processes a newly queued item on the next invocation after an empty probe', async () => {
    prisma.circleReconciliationQueue.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ userId: 7, version: 3 }]).mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    await expect(worker.drainQueue()).resolves.toBe(0);
    await expect(worker.drainQueue()).resolves.toBe(1);
    expect(reconcile).toHaveBeenCalledWith(tx, 7);
    expect(tx.circleReconciliationQueue.deleteMany).toHaveBeenCalledWith({ where: { userId: 7, version: 3 } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('tolerates another worker consuming the item between the probe and the lock', async () => {
    prisma.circleReconciliationQueue.findFirst.mockResolvedValue({ userId: 7 });
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(worker.drainQueue()).resolves.toBe(0);
    expect(reconcile).not.toHaveBeenCalled();
    expect(tx.circleReconciliationQueue.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves queued work available when the user row is locked', async () => {
    prisma.circleReconciliationQueue.findFirst.mockResolvedValue({ userId: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ userId: 7, version: 3 }]).mockResolvedValueOnce([]);
    await expect(worker.drainQueue()).resolves.toBe(0);
    expect(reconcile).not.toHaveBeenCalled();
    expect(tx.circleReconciliationQueue.deleteMany).not.toHaveBeenCalled();
  });

  it('clears the running guard if the lightweight read fails, so the next tick can retry', async () => {
    prisma.circleReconciliationQueue.findFirst.mockRejectedValueOnce(new Error('temporary connection error')).mockResolvedValueOnce(null);
    await expect(worker.drainQueue()).rejects.toThrow('temporary connection error');
    await expect(worker.drainQueue()).resolves.toBe(0);
    expect(prisma.circleReconciliationQueue.findFirst).toHaveBeenCalledTimes(2);
  });

  it('does no work when the caller requests zero items', async () => {
    await expect(worker.drainQueue(0)).resolves.toBe(0);
    expect(prisma.circleReconciliationQueue.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
