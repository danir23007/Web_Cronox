import path from 'node:path';
const presence = require(path.resolve(__dirname, '../../../cronox-front/assets/checkout-presence.js'));
const lifecycle = require(path.resolve(__dirname, '../../../cronox-front/assets/checkout-lifecycle.js'));

describe('checkout presence and payment confirmation fence', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-27T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  const state = () => ({ checkoutSnapshotId: 'snap', reservationPhase: 'PRESENCE', paymentStartedAt: null, serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 90000).toISOString() });
  it('does not claim reservation before server acknowledgement; heartbeats do not re-enter after expiry', async () => {
    let finish!: (value: any) => void;
    const request = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValue(new Error('EXPIRED'));
    const client = presence.create({ request, uuid: () => 'page-a' });
    const entering = client.enter(); expect(client.ready()).toBe(false); finish(state()); await entering; expect(client.ready()).toBe(true);
    await jest.advanceTimersByTimeAsync(20000); expect(client.ready()).toBe(false);
    await jest.advanceTimersByTimeAsync(100000);
    expect(request.mock.calls.filter(([, body]) => body.action === 'enter')).toHaveLength(1); client.stop();
  });
  it('uses server time and preserves protected deadline on retry; page departure is only a server request', async () => {
    const protectedState = { ...state(), reservationPhase: 'PROTECTED', paymentStartedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 360000).toISOString() };
    const request = jest.fn().mockResolvedValueOnce(state()).mockImplementation(async () => ({ ...protectedState, serverNow: new Date().toISOString() }));
    const client = presence.create({ request, uuid: () => 'page-a' }); await client.enter(); await client.protect('pi_test');
    await jest.advanceTimersByTimeAsync(180000); await client.protect('pi_test'); expect(client.current().expiresAt).toBe(protectedState.expiresAt);
    await client.leave(false); expect(request).toHaveBeenLastCalledWith('reservation', { action: 'depart', tabId: 'page-a' }, true);
    const count = request.mock.calls.length; await jest.advanceTimersByTimeAsync(180001); expect(request).toHaveBeenCalledTimes(count); expect(client.ready()).toBe(false);
  });
  it.each(['confirmMountedPayment', 'confirmExpressPayment'])('%s validates before protection and awaits it before contacting Stripe', async name => {
    const order: string[] = []; let release!: () => void;
    const beforeConfirm = jest.fn(() => { order.push('protect'); return new Promise<void>(resolve => { release = resolve; }); });
    const args = { stripe: { confirmPayment: jest.fn(async () => { order.push('confirm'); return {}; }) }, elements: { submit: jest.fn(async () => { order.push('validate'); return {}; }) }, clientSecret: 'fixture', paymentElementMounted: true, expressCheckoutMounted: true, beforeConfirm };
    const pending = lifecycle[name](args); await Promise.resolve(); await Promise.resolve(); expect(order).toEqual(['validate', 'protect']); expect(args.stripe.confirmPayment).not.toHaveBeenCalled();
    release(); await pending; expect(order).toEqual(['validate', 'protect', 'confirm']);
    args.elements.submit.mockResolvedValueOnce({ error: { message: 'invalid' } } as never); beforeConfirm.mockClear(); args.stripe.confirmPayment.mockClear();
    await lifecycle[name](args); expect(beforeConfirm).not.toHaveBeenCalled(); expect(args.stripe.confirmPayment).not.toHaveBeenCalled();
  });
  it('never confirms when the protection transition fails or its response is lost', async () => {
    const stripe = { confirmPayment: jest.fn() };
    const result = await lifecycle.confirmMountedPayment({ stripe, elements: { submit: async () => ({}) }, clientSecret: 'fixture', paymentElementMounted: true, beforeConfirm: async () => { throw new Error('network'); } });
    expect(result.error.message).toBe('network'); expect(stripe.confirmPayment).not.toHaveBeenCalled();
  });
  it('does not turn a response delayed beyond 360s into a fresh payment window', async () => {
    let reply!: (value: any) => void;
    const initial = state();
    const request = jest.fn().mockResolvedValueOnce(initial).mockImplementation(() => new Promise(resolve => { reply = resolve; }));
    const client = presence.create({ request, uuid: () => 'page-a', schedule: () => 0 }); await client.enter();
    const pending = client.protect('pi_test');
    const protectedState = { ...initial, reservationPhase: 'PROTECTED', paymentStartedAt: initial.serverNow, expiresAt: new Date(Date.now() + 360000).toISOString() };
    jest.setSystemTime(Date.now() + 360001); reply(protectedState);
    await expect(pending).rejects.toThrow('caducado'); expect(client.ready()).toBe(false);
  });
  it('gives restored pages different identities so delayed departure cannot target the new page', async () => {
    let id = 0; const request = jest.fn().mockImplementation(async () => state());
    const client = presence.create({ request, uuid: () => `page-${++id}` }); await client.enter(); await client.leave(); await client.restore();
    expect(request.mock.calls.map(([, body]) => [body.action, body.tabId])).toEqual([['enter', 'page-1'], ['depart', 'page-1'], ['enter', 'page-2']]); client.stop();
  });
});
