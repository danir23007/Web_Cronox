import { BankTransferService } from './bank-transfer.service';
import { StripeService } from './stripe.service';
import { ConflictException } from '@nestjs/common';

describe('bank transfer safety', () => {
  const owner = { anonymousId: 'owner-1', customerEmail: 'buyer@example.test' };
  let service: BankTransferService;
  let orders: any;
  let stripe: any;
  let factory: any;
  beforeEach(() => {
    orders = {
      getOwnedBankTransferSnapshot: jest
        .fn()
        .mockResolvedValue({
          id: 'snap',
          orderId: 1,
          totalCents: 3790,
          currency: 'EUR',
          customerEmail: owner.customerEmail,
          status: 'BANK_TRANSFER_PENDING',
          expiresAt: new Date(Date.now() + 10000),
          order: { status: 'PENDING' },
        }),
      reserveBankTransfer: jest.fn(),
      releaseCheckoutSnapshot: jest.fn(),
    };
    stripe = {
      prepareBankTransfer: jest.fn(),
      confirmBankTransfer: jest.fn(),
      cancelCheckoutPaymentIntent: jest.fn(),
      retrieveBankTransfer: jest
        .fn()
        .mockResolvedValue({
          status: 'requires_action',
          next_action: {
            display_bank_transfer_instructions: {
              amount_remaining: 790,
              reference: 'REFERENCE',
              financial_addresses: [
                {
                  type: 'iban',
                  iban: {
                    iban: 'TEST-IBAN',
                    bic: 'TEST-BIC',
                    account_holder_name: 'TEST',
                  },
                },
              ],
            },
          },
        }),
    };
    factory = {
      createPaymentIntentForOwner: jest
        .fn()
        .mockResolvedValue({ paymentIntentId: 'pi_test' }),
    };
    service = new BankTransferService(stripe, orders, factory);
  });
  it('returns only owner-authorized instructions and the partially funded remainder', async () => {
    const result = await service.get(owner, 'pi_test');
    expect(orders.getOwnedBankTransferSnapshot).toHaveBeenCalledWith(
      owner,
      'pi_test',
    );
    expect(result).toMatchObject({
      orderStatus: 'PENDING',
      amountRemainingCents: 790,
      reference: 'REFERENCE',
    });
    expect(result).not.toHaveProperty('clientSecret');
    expect(result).not.toHaveProperty('customer');
  });
  it('does not expose Stripe information to a different owner', async () => {
    orders.getOwnedBankTransferSnapshot.mockRejectedValue(
      new Error('Not found'),
    );
    await expect(service.get(owner, 'pi_test')).rejects.toThrow('Not found');
    expect(stripe.retrieveBankTransfer).not.toHaveBeenCalled();
  });
  it.each([false,true])('admission denial retains ordinary presence without starting or canceling payment (provider fails: %s)', async providerFails => {
    orders.getOwnedBankTransferSnapshot.mockResolvedValue({id:'snap',status:'PAYMENT_BOUND',totalCents:3790,currency:'EUR',customerEmail:owner.customerEmail});
    orders.reserveBankTransfer.mockRejectedValue(new ConflictException('BANK_TRANSFER_RESERVATION_LIMIT'));
    if(providerFails)stripe.cancelCheckoutPaymentIntent.mockRejectedValue(new Error('Provider unavailable'));
    await expect(service.begin(owner,{} as any,null)).rejects.toThrow('BANK_TRANSFER_RESERVATION_LIMIT');
    expect(stripe.confirmBankTransfer).not.toHaveBeenCalled();
    expect(stripe.cancelCheckoutPaymentIntent).not.toHaveBeenCalled();
    expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
  it('does not release stock after an unconfirmed cancellation', async () => {
    stripe.cancelCheckoutPaymentIntent.mockRejectedValue(
      new Error('Already processing'),
    );
    await expect(service.cancel(owner, 'pi_test')).rejects.toThrow(
      'Already processing',
    );
    expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
  it('cancels at Stripe before releasing inventory', async () => {
    await service.cancel(owner, 'pi_test');
    expect(
      stripe.cancelCheckoutPaymentIntent.mock.invocationCallOrder[0],
    ).toBeLessThan(orders.releaseCheckoutSnapshot.mock.invocationCallOrder[0]);
  });
  it('does not resume an expired transfer', async () => {
    orders.getOwnedBankTransferSnapshot.mockResolvedValue({
      status: 'BANK_TRANSFER_PENDING',
      expiresAt: new Date(0),
    });
    await expect(service.resume(owner, 'pi_test')).rejects.toThrow(
      'BANK_TRANSFER_NOT_PENDING',
    );
    expect(stripe.confirmBankTransfer).not.toHaveBeenCalled();
  });
  it('reserves stock and creates the pending order before confirming the bank intent', async () => {
    const snapshot = {
      id: 'snap',
      totalCents: 3790,
      currency: 'EUR',
      customerEmail: owner.customerEmail,
      status: 'PAYMENT_BOUND',
    };
    orders.getOwnedBankTransferSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({
        ...snapshot,
        orderId: 1,
        order: { status: 'PENDING' },
      });
    await service.begin(owner, {} as any, null);
    expect(stripe.prepareBankTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      orders.reserveBankTransfer.mock.invocationCallOrder[0],
    );
    expect(orders.reserveBankTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.confirmBankTransfer.mock.invocationCallOrder[0],
    );
  });
});

describe('bank transfer Dashboard selection', () => {
  let service: StripeService;
  let client: any;
  beforeEach(() => {
    jest.restoreAllMocks();
    service = new StripeService({
      get: (key: string) =>
        key === 'STRIPE_SECRET_KEY' ? 'sk_test_fixture' : undefined,
    } as any);
    client = (service as any).stripe;
  });
  it('only uses the active default configuration', async () => {
    jest.spyOn(client.paymentMethodConfigurations, 'list').mockResolvedValue({
      data: [
        {
          is_default: false,
          active: true,
          customer_balance: { available: true },
        },
        {
          is_default: true,
          active: true,
          customer_balance: { available: false },
        },
      ],
    });
    await expect(service.isBankTransferAvailable()).resolves.toBe(false);
  });
  it('cannot force a Dashboard-disabled bank method', async () => {
    jest
      .spyOn(client.paymentIntents, 'retrieve')
      .mockResolvedValue({
        id: 'pi_test',
        amount: 3790,
        currency: 'eur',
        status: 'requires_payment_method',
        metadata: { checkoutSnapshotId: 'snap' },
      });
    jest.spyOn(service, 'isBankTransferAvailable').mockResolvedValue(false);
    const createCustomer = jest.spyOn(client.customers, 'create');
    await expect(
      service.prepareBankTransfer({
        paymentIntentId: 'pi_test',
        checkoutSnapshotId: 'snap',
        amount: 3790,
        currency: 'EUR',
        email: 'buyer@example.test',
      }),
    ).rejects.toThrow('BANK_TRANSFER_NOT_AVAILABLE');
    expect(createCustomer).not.toHaveBeenCalled();
  });
  it('keeps existing funding instructions on retry without reconfirming', async () => {
    jest
      .spyOn(client.paymentIntents, 'retrieve')
      .mockResolvedValue({
        id: 'pi_test',
        metadata: { checkoutSnapshotId: 'snap' },
        status: 'requires_action',
        next_action: { type: 'display_bank_transfer_instructions' },
      });
    const confirm = jest.spyOn(client.paymentIntents, 'confirm');
    await service.confirmBankTransfer('pi_test', 'snap');
    expect(confirm).not.toHaveBeenCalled();
  });
});
