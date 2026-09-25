import { Decimal } from '@prisma/client/runtime/library';
import { CircleService } from './circle.service';

describe('CircleService net spend', () => {
  it('does not subtract already-excluded refunded orders a second time', async () => {
    const prisma = { order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: new Decimal(125) } }) } };
    const service = new CircleService(prisma as any, {} as any);

    await expect(service.getNetSpent(7)).resolves.toEqual(new Decimal(125));
    expect(prisma.order.aggregate).toHaveBeenCalledTimes(1);
    expect(prisma.order.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 7 }),
    }));
  });
});
