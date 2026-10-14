import { BankTransferController } from './bank-transfer.controller';

describe('bank transfer guest ownership lifetime', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const deadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const anonymousId = 'bank-guest-owner-fixture';
  const req = { cookies: {cartId: anonymousId} } as any;
  let banks: {get: jest.Mock};
  let res: {cookie: jest.Mock};
  let controller: BankTransferController;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    banks = {get: jest.fn().mockResolvedValue({orderStatus:'PENDING',expiresAt:deadline})};
    res = {cookie:jest.fn()};
    controller = new BankTransferController(banks as any, {} as any, {
      getCheckoutCartForRequest: jest.fn().mockResolvedValue({userId:null,anonymousId}),
    } as any);
  });
  afterEach(() => jest.useRealTimers());
  it('keeps the owner cookie through the original deadline without extending it on subsequent reads', async () => {
    await controller.get(req, 'pi_fixture', res as any);
    expect(res.cookie).toHaveBeenLastCalledWith('cartId', anonymousId, expect.objectContaining({httpOnly:true,path:'/api',maxAge:72*60*60*1000}));
    jest.setSystemTime(new Date(now.getTime()+24*60*60*1000));
    await controller.get(req, 'pi_fixture', res as any);
    expect(res.cookie).toHaveBeenLastCalledWith('cartId', anonymousId, expect.objectContaining({maxAge:48*60*60*1000}));
    jest.setSystemTime(new Date(deadline.getTime()-15*60*1000));
    await controller.get(req, 'pi_fixture', res as any);
    expect(res.cookie).toHaveBeenLastCalledWith('cartId', anonymousId, expect.objectContaining({maxAge:15*60*1000}));
  });
  it('never issues an owner cookie when authorization fails', async () => {
    banks.get.mockRejectedValue(new Error('Owner mismatch'));
    await expect(controller.get(req, 'pi_other', res as any)).rejects.toThrow('Owner mismatch');
    expect(res.cookie).not.toHaveBeenCalled();
  });
  it('uses the normal guest lifetime for terminal orders', async () => {
    banks.get.mockResolvedValue({orderStatus:'CANCELLED',expiresAt:deadline});
    await controller.get(req, 'pi_fixture', res as any);
    expect(res.cookie).toHaveBeenLastCalledWith('cartId', anonymousId, expect.objectContaining({maxAge:60*60*1000}));
  });
  it('does not issue a guest cookie for an authenticated owner', async () => {
    await controller.get({...req,user:{id:1}} as any, 'pi_fixture', res as any);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it.each([
    ['127.0.0.1', '198.51.100.4', '127.0.0.1', '198.51.100.4'],
    ['::ffff:127.0.0.1', '198.51.100.5', '127.0.0.1', '198.51.100.5'],
    ['::1', '2001:db8::1', '::1', '2001:db8::1'],
    ['198.51.100.6', '203.0.113.99', '203.0.113.98', '198.51.100.6'],
    ['127.0.0.1', 'invalid', '198.51.100.7', '198.51.100.7'],
  ])('uses the trusted bank network for peer %s without trusting a public-origin header', async (peer, forwarded, expressIp, expected) => {
    const begin = jest.fn().mockResolvedValue({ orderStatus: 'PENDING', expiresAt: deadline });
    const carts = { getCheckoutCartForRequest: jest.fn().mockResolvedValue({ userId: null, anonymousId }) };
    const bankController = new BankTransferController({ begin } as any, {} as any, carts as any);
    await bankController.begin({ ...req, ip: expressIp, socket: { remoteAddress: peer }, headers: { 'x-real-ip': forwarded } } as any,
      { guestEmail: 'bank@example.test' } as any, res as any);
    expect(begin).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expected);
  });
});
