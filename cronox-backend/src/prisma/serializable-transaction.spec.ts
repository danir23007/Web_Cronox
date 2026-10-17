import { serializableTransaction } from './serializable-transaction';

describe('serializable database-only retries', () => {
  it.each([{ code: 'P2034' }, { code: 'P2010', meta: { code: '40001' } }, { code: 'P2010', meta: { code: '40P01' } }])('restarts the whole transaction for %j', async error => {
    const db: any = { $transaction: jest.fn().mockRejectedValueOnce(error).mockResolvedValue('committed') };
    const operation = jest.fn();
    await expect(serializableTransaction(db, operation)).resolves.toBe('committed');
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.$transaction).toHaveBeenLastCalledWith(operation, { isolationLevel: 'Serializable' });
  });
  it('bounds conflicts to four attempts', async () => {
    const error = { code: 'P2010', meta: { code: '40001' } };
    const db: any = { $transaction: jest.fn().mockRejectedValue(error) };
    await expect(serializableTransaction(db, jest.fn())).rejects.toBe(error);
    expect(db.$transaction).toHaveBeenCalledTimes(4);
  });
  it.each([{ code: 'P2010', meta: { code: '23505' } }, { code: 'P2010' }, { code: 'P2002' }, new Error('unrelated')])('does not retry an unrelated failure %j', async error => {
    const db: any = { $transaction: jest.fn().mockRejectedValue(error) };
    await expect(serializableTransaction(db, jest.fn())).rejects.toBe(error);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
