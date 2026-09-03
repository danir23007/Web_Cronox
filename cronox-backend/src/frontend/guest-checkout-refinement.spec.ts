import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('guest checkout final refinement', () => {
  const frontendRoot = join(__dirname, '..', '..', '..', 'cronox-front');
  const html = readFileSync(join(frontendRoot, 'checkout.html'), 'utf8');
  const script = readFileSync(
    join(frontendRoot, 'assets', 'checkout.js'),
    'utf8',
  );
  const css = readFileSync(
    join(frontendRoot, 'assets', 'checkout.css'),
    'utf8',
  );

  it('renders an optional, unchecked guest contact and marketing-consent UI', () => {
    expect(html).toContain('id="checkout-guest-email"');
    expect(html).toContain('id="checkout-login-header-link"');
    expect(html).toContain('id="checkout-newsletter-consent" type="checkbox"');
    expect(html).not.toContain(
      'id="checkout-newsletter-consent" type="checkbox" checked',
    );
  });

  it('keeps guest checkout on the canonical backend summary and PaymentIntent routes', () => {
    expect(script).toContain(
      'await refreshCheckoutSummary(state.shippingMethod',
    );
    expect(script).toContain('/api/payments/create-payment-intent');
    expect(script).toContain(
      'guestEmail: state.isAuthenticated ? undefined : getCheckoutEmail()',
    );
    expect(script).toContain('shippingAddress: requestedShippingAddress');
  });

  it('subscribes only after explicit optional consent through NewsletterModule', () => {
    expect(script).toContain('newsletterConsent?.checked');
    expect(script).toContain('/api/newsletter/subscribe');
    expect(script).toContain('newsletterSubmittedFor === email');
  });

  it('renders the compact account row and hidden logout menu', () => {
    expect(html).toContain('id="checkout-customer" class="checkout-customer"');
    expect(html).toContain('id="checkout-account-menu-button"');
    expect(html).toContain(
      'id="checkout-account-menu" class="checkout-menu__popup" role="menu" hidden',
    );
    expect(html).toContain('id="checkout-logout-button"');
    expect(css).toContain('flex-basis: 30px');
  });

  it('uses the real auth API and clears saved profile/address state on logout', () => {
    expect(script).toContain('await API.logout?.()');
    expect(script).toContain('savedDefaultAddress = null');
    expect(script).toContain(
      "new CustomEvent('cronox:userChanged', { detail: null })",
    );
  });

  it('builds the collapsed address from every structured shipping component', () => {
    for (const expression of [
      'shippingFields.address?.value',
      'shippingFields.addressLine2?.value',
      'shippingFields.zip?.value',
      'shippingFields.city?.value',
      'shippingFields.state?.value',
      'shippingFields.country?.value',
    ]) {
      expect(script).toContain(expression);
    }
    expect(script).toContain('addressSummaryEl.replaceChildren(');
  });

  it('keeps a saved-address inner card with default badge and explicit edit menu', () => {
    expect(html).toContain('id="default-address-card" class="default-address"');
    expect(html).toContain('Predeterminada');
    expect(html).toContain('id="address-menu-button"');
    expect(html).toContain('id="edit-address-button"');
    expect(html).toContain('id="different-address-button"');
    expect(html).toMatch(
      /<p id="default-address-lines"><\/p>\s*<\/div>\s*<button id="different-address-button"/,
    );
    expect(css).toContain('#address-details[open] > summary #address-summary');
  });

  it('keeps the default address selectable above the temporary alternative form', () => {
    const cardPosition = html.indexOf('id="default-address-card"');
    const formPosition = html.indexOf('id="shipping-form"');

    expect(cardPosition).toBeGreaterThan(-1);
    expect(cardPosition).toBeLessThan(formPosition);
    expect(html).toContain('id="saved-address-select-button"');
    expect(html).toContain('aria-label="Usar la dirección predeterminada"');
    expect(script).toContain(
      'if (defaultAddressCard) defaultAddressCard.hidden = !savedDefaultAddress',
    );
    expect(script).toContain('setSavedAddressSelected(false)');
    expect(script).toContain('savedAddressSelectButton?.addEventListener');
    expect(script).toContain("defaultAddressCard?.addEventListener('click'");
    expect(script).toContain('event.target.closest(\'button, [role="menu"]\')');
    expect(script).toContain('showSavedAddress({ refreshPayment: true })');
  });

  it('uses only accessible hidden labels and exact in-field alternative-address text', () => {
    const formStart = html.indexOf('<form id="shipping-form"');
    const formEnd = html.indexOf('</form>', formStart);
    const shippingForm = html.slice(formStart, formEnd);

    expect(shippingForm).toContain('<option value="España">España</option>');
    for (const placeholder of [
      'Nombre',
      'Apellidos',
      'Dirección (Calle y Número)',
      'Apartamento, piso, etc. (opcional)',
      'Código postal',
      'Ciudad',
      'Provincia',
      'Teléfono',
    ]) {
      expect(shippingForm).toContain(`placeholder="${placeholder}"`);
    }
    expect(
      shippingForm.match(/class="checkout-visually-hidden"/g),
    ).toHaveLength(9);
    expect(shippingForm).not.toContain('<span>Nombre</span>');
    expect(shippingForm).not.toContain('placeholder="Calle y número"');
    expect(shippingForm).not.toContain('placeholder="00000"');
    expect(css).toContain('.checkout-visually-hidden');
  });

  it('provides an accessible structured edit-address modal', () => {
    expect(html).toContain('role="dialog" aria-modal="true"');
    for (const field of [
      'country',
      'firstName',
      'lastName',
      'line1',
      'line2',
      'zip',
      'city',
      'state',
      'phone',
      'isDefault',
    ]) {
      expect(html).toContain(`name="${field}"`);
    }
    expect(script).toContain("event.key !== 'Tab'");
    expect(script).toContain("event.key === 'Escape'");
  });

  it('updates the existing address ID with PATCH and refreshes checkout safely', () => {
    expect(script).toContain(
      '/api/me/addresses/${encodeURIComponent(savedDefaultAddress.id)}',
    );
    expect(script).toContain("method: 'PATCH'");
    expect(script).toContain(
      'await API.getDefaultAddress().catch(() => updated)',
    );
    expect(script).toContain('await queueCheckoutUpdate()');
  });

  it('keeps cancel/close non-mutating and a different address checkout-only', () => {
    expect(script).toContain(
      "addressModalCancel?.addEventListener('click', closeAddressModal)",
    );
    expect(script).toContain(
      "addressModalClose?.addEventListener('click', closeAddressModal)",
    );
    expect(script).toContain('differentAddressButton?.addEventListener');
    expect(script).not.toContain('API.upsertAddress');
  });

  it('implements mutually exclusive accessible menus and mobile-safe modal sizing', () => {
    expect(script).toContain('closeCheckoutMenus(willOpen ? menu : null)');
    expect(script).toContain(
      "button.setAttribute('aria-expanded', String(willOpen))",
    );
    expect(css).toContain('width: min(100%, 570px)');
    expect(css).toContain(
      'max-height: min(760px, calc(100dvh - max(20px,env(safe-area-inset-top)) - max(20px,env(safe-area-inset-bottom))))',
    );
  });
});
