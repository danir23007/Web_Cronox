import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const flush = async () => {
  for (let index = 0; index < 25; index++) await Promise.resolve();
};
const pendingOrder = {
  paymentIntentId: 'pi_fixture',
  orderId: 1,
  orderStatus: 'PENDING',
  paymentStatus: 'requires_action',
  expiresAt: '2026-10-16T12:00:00Z',
  totalCents: 3790,
  amountRemainingCents: 790,
  reference: 'FIXTURE-REFERENCE',
  accounts: [
    { iban: 'TEST-NOT-A-BANK', bic: 'TEST-BIC', beneficiary: 'Fixture' },
  ],
};
const setup = (available = true, storedRef?: string) => {
  const dom = new JSDOM(read('checkout.html'), {
    runScripts: 'outside-only',
    url: 'https://fixture.test/checkout',
  });
  const w = dom.window as any;
  w.CRONOX_API = {
    getCsrfHeaders: jest.fn().mockResolvedValue({ 'X-CSRF-Token': 'fixture' }),
  };
  w.fetch = jest.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () => (url.includes('?ref=') ? pendingOrder : { available }),
    }),
  );
  if (storedRef)
    w.sessionStorage.setItem('cronox_pending_bank_transfer', storedRef);
  w.eval(read('assets/checkout-bank-transfer.js'));
  return { dom, w };
};

describe('bank transfer frontend', () => {
  it('returns to other methods with a clear message after a safely canceled admission denial', async () => {
    const {dom,w}=setup();
    try {
      await flush();
      w.dispatchEvent(new w.CustomEvent('cronox:checkout-payment-ready',{detail:{paymentIntentId:'pi_fixture',payload:{shippingMethod:'STANDARD'}}}));
      w.fetch.mockResolvedValueOnce({ok:false,json:async()=>({message:'BANK_TRANSFER_RESERVATION_LIMIT'})});
      w.fetch.mockResolvedValueOnce({ok:false,json:async()=>({message:'BANK_TRANSFER_NOT_STARTED'})});
      w.document.querySelector('#bank-transfer-start').click();
      await flush();
      expect(w.document.querySelector('#bank-transfer-error').textContent).toContain('Puedes usar otro método de pago');
      expect(w.document.querySelector('#shipping-form [name=city]').disabled).toBe(false);
      expect(w.sessionStorage.getItem('cronox_pending_bank_transfer')).toBeNull();
    } finally {dom.window.close();}
  });
  it('restores a stored pending reference even before any cart/payment-ready event', async () => {
    const { dom, w } = setup(true, 'pi_fixture');
    try {
      await flush();
      expect(
        w.document.querySelector('#bank-transfer-instructions').textContent,
      ).toContain('FIXTURE-REFERENCE');
      expect(
        w.document.querySelector('#shipping-form [name=city]').disabled,
      ).toBe(true);
      expect(w.fetch).toHaveBeenCalledWith(
        expect.stringContaining('?ref=pi_fixture'),
        expect.objectContaining({ credentials: 'include' }),
      );
    } finally {
      dom.window.close();
    }
  });
  it('hides bank payment when the Dashboard does not permit it', async () => {
    const { dom, w } = setup(false);
    try {
      await flush();
      expect(w.document.querySelector('#bank-transfer-option').hidden).toBe(
        true,
      );
    } finally {
      dom.window.close();
    }
  });
  it('uses server-approved checkout data and freezes changes until confirmed cancellation', async () => {
    const { dom, w } = setup();
    try {
      await flush();
      const payload = {
        shippingMethod: 'STANDARD',
        guestEmail: 'buyer@example.test',
        shippingAddress: { city: 'Madrid' },
      };
      w.dispatchEvent(
        new w.CustomEvent('cronox:checkout-payment-ready', {
          detail: { paymentIntentId: 'pi_fixture', payload },
        }),
      );
      w.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => pendingOrder,
      });
      w.document.querySelector('#bank-transfer-start').click();
      await flush();
      expect(JSON.parse(w.fetch.mock.calls[1][1].body)).toEqual(payload);
      expect(w.fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('fixture');
      expect(
        w.document.querySelector('#shipping-form [name=city]').disabled,
      ).toBe(true);
      expect(
        w.document.querySelector('#bank-transfer-instructions').textContent,
      ).toContain('7,90');
      expect(
        w.document.querySelector('#bank-transfer-instructions').textContent,
      ).toContain('FIXTURE-REFERENCE');
      w.fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          message: 'CHECKOUT_PAYMENT_CONFIRMATION_PENDING',
        }),
      });
      w.document.querySelector('#bank-transfer-cancel').click();
      await flush();
      expect(
        w.document.querySelector('#shipping-form [name=city]').disabled,
      ).toBe(true);
      w.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cancelled: true }),
      });
      w.document.querySelector('#bank-transfer-cancel').click();
      await flush();
      expect(
        w.document.querySelector('#shipping-form [name=city]').disabled,
      ).toBe(false);
    } finally {
      dom.window.close();
    }
  });
  it('recovers the pending order after reload even if new bank payments are disabled', async () => {
    const { dom, w } = setup(false);
    try {
      await flush();
      w.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => pendingOrder,
      });
      w.dispatchEvent(
        new w.CustomEvent('cronox:bank-transfer-pending', {
          detail: { paymentIntentId: 'pi_fixture' },
        }),
      );
      await flush();
      expect(w.document.querySelector('#bank-transfer-option').hidden).toBe(
        false,
      );
      expect(
        w.document.querySelector('#bank-transfer-instructions').textContent,
      ).toContain('TEST-NOT-A-BANK');
      expect(w.document.querySelector('#bank-transfer-start').hidden).toBe(
        true,
      );
    } finally {
      dom.window.close();
    }
  });
  it('cannot start a bank payment while a wallet confirmation is open', async () => {
    const { dom, w } = setup();
    try {
      await flush();
      w.addEventListener('cronox:bank-transfer-lock', (event: any) =>
        event.preventDefault(),
      );
      w.dispatchEvent(
        new w.CustomEvent('cronox:checkout-payment-ready', {
          detail: { paymentIntentId: 'pi_fixture', payload: {} },
        }),
      );
      w.document.querySelector('#bank-transfer-start').click();
      await flush();
      expect(w.fetch).toHaveBeenCalledTimes(1);
    } finally {
      dom.window.close();
    }
  });
  it('keeps normal payment blocked after an ambiguous response until the server proves no transfer exists', async () => {
    const { dom, w } = setup();
    try {
      await flush();
      w.dispatchEvent(
        new w.CustomEvent('cronox:checkout-payment-ready', {
          detail: { paymentIntentId: 'pi_fixture', payload: {} },
        }),
      );
      w.fetch
        .mockRejectedValueOnce(new Error('Network failure'))
        .mockRejectedValueOnce(new Error('Network failure'));
      w.document.querySelector('#bank-transfer-start').click();
      await flush();
      expect(
        w.document.querySelector('#shipping-form [name=city]').disabled,
      ).toBe(true);
      expect(w.document.querySelector('#bank-transfer-refresh').hidden).toBe(
        false,
      );
    } finally {
      dom.window.close();
    }
  });
});
