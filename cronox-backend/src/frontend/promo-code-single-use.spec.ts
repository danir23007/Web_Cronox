import { readFileSync } from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('checkout single-use promo identity', () => {
  it('sends the guest email for both applying and refreshing a promo', () => {
    const checkout = readFrontend('assets/checkout.js');
    const apiSource = readFrontend('src/admin/api.ts');

    const applyBlock = checkout.slice(
      checkout.indexOf('const applyPromoCode ='),
      checkout.indexOf('const removePromoCode ='),
    );
    const summaryBlock = checkout.slice(
      checkout.indexOf('const refreshCheckoutSummary ='),
      checkout.indexOf('const buildPaymentReturnUrl ='),
    );

    expect(applyBlock).toContain(
      'guestEmail: state.isAuthenticated ? undefined : getCheckoutEmail()',
    );
    expect(summaryBlock).toContain(
      'guestEmail: state.isAuthenticated ? undefined : getCheckoutEmail()',
    );
    expect(apiSource).toContain('body.guestEmail = payload.guestEmail');
    expect(apiSource).toContain('query.guestEmail = params.guestEmail');
  });

  it('shows the backend Spanish rejection message in the promo area', () => {
    const checkout = readFrontend('assets/checkout.js');
    const applyBlock = checkout.slice(
      checkout.indexOf('const applyPromoCode ='),
      checkout.indexOf('const removePromoCode ='),
    );

    expect(applyBlock).toContain(
      'setPromoMessage(error.payload.message, true)',
    );
    expect(checkout).toContain(
      "if (details.code === 'PROMO_ALREADY_REDEEMED')",
    );
    expect(checkout).toContain(
      "setPromoMessage('Ya has utilizado este código de descuento.', true)",
    );
  });
});
