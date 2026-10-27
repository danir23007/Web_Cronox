import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { OrdersService, type CheckoutOwner } from '../orders/orders.service';
import type { CartWithItems } from '../cart/cart.service';
import { StripeService } from './stripe.service';
import { PaymentIntentFactory } from './payment-intent.factory';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

@Injectable()
export class BankTransferService {
  constructor(
    private readonly stripe: StripeService,
    private readonly orders: OrdersService,
    private readonly factory: PaymentIntentFactory,
  ) {}

  async begin(
    owner: CheckoutOwner,
    dto: CreatePaymentIntentDto,
    cart: CartWithItems | null,
    network = 'internal',
  ) {
    let paymentIntentId: string;
    try {
      const payment = await this.factory.createPaymentIntentForOwner(
        owner,
        dto,
        cart,
      );
      paymentIntentId = payment.paymentIntentId;
    } catch (error) {
      const response =
        error instanceof ConflictException ? error.getResponse() : null;
      if (
        !response ||
        typeof response !== 'object' ||
        !('code' in response) ||
        response.code !== 'CHECKOUT_BANK_TRANSFER_PENDING' ||
        !('paymentIntentId' in response) ||
        typeof response.paymentIntentId !== 'string'
      )
        throw error;
      paymentIntentId = response.paymentIntentId;
    }
    const snapshot = await this.orders.getOwnedBankTransferSnapshot(
      owner,
      paymentIntentId,
    );
    if (snapshot.status !== 'BANK_TRANSFER_PENDING') {
      await this.stripe.prepareBankTransfer({
        paymentIntentId,
        checkoutSnapshotId: snapshot.id,
        amount: snapshot.totalCents,
        currency: snapshot.currency,
        email: snapshot.customerEmail,
      });
      try {
        await this.orders.reserveBankTransfer(snapshot.id, paymentIntentId, network, dto.tabId);
      } catch (error) {
        const response = error instanceof ConflictException ? error.getResponse() : null;
        const code = typeof response === 'string' ? response : response && typeof response === 'object' && 'message' in response ? response.message : null;
        if (code === 'BANK_TRANSFER_RESERVATION_LIMIT' || code === 'BANK_TRANSFER_STOCK_RESERVATION_LIMIT') {
          // Admission failed before payment started: retain ordinary checkout
          // presence so another payment method can be selected without renewal.
        }
        throw error;
      }
    }
    await this.stripe.confirmBankTransfer(paymentIntentId, snapshot.id);
    return this.get(owner, paymentIntentId);
  }

  async get(owner: CheckoutOwner, paymentIntentId: string) {
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId))
      throw new BadRequestException('BANK_TRANSFER_REFERENCE_REQUIRED');
    const snapshot = await this.orders.getOwnedBankTransferSnapshot(
      owner,
      paymentIntentId,
    );
    if (!snapshot.orderId)
      throw new BadRequestException('BANK_TRANSFER_NOT_STARTED');
    const intent = await this.stripe.retrieveBankTransfer(
      paymentIntentId,
      snapshot.id,
    );
    const bank = intent.next_action?.display_bank_transfer_instructions;
    return {
      paymentIntentId,
      orderId: snapshot.orderId,
      orderStatus: snapshot.order?.status,
      paymentStatus: intent.status,
      expiresAt: snapshot.expiresAt,
      totalCents: snapshot.totalCents,
      currency: snapshot.currency,
      amountRemainingCents: bank?.amount_remaining ?? null,
      reference: bank?.reference ?? null,
      accounts: (bank?.financial_addresses ?? []).flatMap((address) => {
        if (address.type !== 'iban' || !address.iban) return [];
        return [
          {
            iban: address.iban.iban,
            bic: address.iban.bic,
            beneficiary: address.iban.account_holder_name,
          },
        ];
      }),
      // Instructions are fetched through an owner-authorized endpoint. No
      // client secret or customer identity is included in this response.
    };
  }

  async cancel(owner: CheckoutOwner, paymentIntentId: string) {
    const snapshot = await this.orders.getOwnedBankTransferSnapshot(
      owner,
      paymentIntentId,
    );
    if (
      snapshot.order?.status === 'CANCELLED' &&
      ['EXPIRED', 'PAYMENT_CANCELLED'].includes(snapshot.status)
    )
      return { cancelled: true };
    if (snapshot.status !== 'BANK_TRANSFER_PENDING')
      throw new ConflictException('BANK_TRANSFER_NOT_PENDING');
    await this.stripe.cancelCheckoutPaymentIntent(paymentIntentId, snapshot.id);
    await this.orders.releaseCheckoutSnapshot(
      snapshot.id,
      'PAYMENT_CANCELLED',
      paymentIntentId,
    );
    return { cancelled: true };
  }

  async resume(owner: CheckoutOwner, paymentIntentId: string) {
    const snapshot = await this.orders.getOwnedBankTransferSnapshot(
      owner,
      paymentIntentId,
    );
    if (
      snapshot.status !== 'BANK_TRANSFER_PENDING' ||
      snapshot.expiresAt <= new Date()
    )
      throw new ConflictException('BANK_TRANSFER_NOT_PENDING');
    await this.stripe.confirmBankTransfer(paymentIntentId, snapshot.id);
    return this.get(owner, paymentIntentId);
  }
}
