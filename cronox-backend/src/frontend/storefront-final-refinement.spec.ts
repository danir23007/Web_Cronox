import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const frontendRoot = path.join(repositoryRoot, 'cronox-front');
const backendRoot = path.join(repositoryRoot, 'cronox-backend', 'src');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const readBackend = (file: string) =>
  readFileSync(path.join(backendRoot, file), 'utf8');
const cssRule = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return '';
  const end = source.indexOf('}', start);
  return source.slice(start, end + 1);
};

describe('focused storefront refinement acceptance matrix', () => {
  const app = readFrontend('assets/app.js');
  const apiSource = readFrontend('src/admin/api.ts');
  const products = readFrontend('assets/products.js');
  const productPage = readFrontend('assets/product-page.js');
  const storeStyles = readFrontend('assets/store.css');
  const checkoutHtml = readFrontend('checkout.html');
  const authModal = readFrontend('auth-modal.html');
  const checkoutScript = readFrontend('assets/checkout.js');
  const checkoutStyles = readFrontend('assets/checkout.css');
  const cookiePolicy = readFrontend('cookie-policy.html');
  const cookieConsent = readFrontend('assets/cookie-consent.js');
  const cartController = readBackend('cart/cart.controller.ts');
  const cartService = readBackend('cart/cart.service.ts');
  const authController = readBackend('auth/auth.controller.ts');
  const authService = readBackend('auth/auth.service.ts');
  const cartCookie = readBackend('common/cookies/cart-cookie.ts');

  it('1. lets a guest create and add to an opaque server cart', () => {
    expect(cartController).toContain('@UseGuards(OptionalJwtAuthGuard)');
    expect(cartController).toContain('this.cartService.addItem(context, dto)');
    expect(apiSource).toContain('withGuestCartRecovery');
    expect(apiSource).toContain('await api.logout()');
  });

  it('2. routes Quick Add through the common cart mutation', () => {
    expect(products).toContain('new CustomEvent("cronox:addToCart"');
    expect(app).toContain("window.addEventListener('cronox:addToCart'");
  });

  it('3. routes product-detail add through the common cart mutation', () => {
    expect(productPage).toContain('addToCart({');
    expect(productPage).toContain('variantId: variant.id');
  });

  it('4. retrieves the guest cart from the same API', () => {
    expect(app).toContain('const cart = await API.getCart()');
    expect(cartController).toContain('this.cartService.getOrCreateCart(context)');
  });

  it('5. reuses the incoming anonymous owner across page requests', () => {
    expect(cartController).toContain('const currentAnonymousId = cookies?.[CART_COOKIE_NAME]');
    expect(cartController).toContain('let anonymousId = currentAnonymousId');
  });

  it('6. generates an opaque identifier and stores no cart JSON client-side', () => {
    expect(cartController).toContain('anonymousId = randomUUID()');
    expect(app).not.toContain('cronox_guest_cart');
    expect(app).not.toContain('syncGuestCartCache');
  });

  it('7. gives the anonymous owner an exact 60-minute lifetime', () => {
    expect(cartCookie).toContain('ANONYMOUS_CART_TTL_MS = 60 * 60 * 1000');
    expect(cartCookie).toContain('maxAge: ANONYMOUS_CART_TTL_MS');
  });

  it('8. rolls that lifetime after successful guest cart activity', () => {
    expect(cartController.match(/refreshExisting: true/g)).toHaveLength(4);
    expect(cartController).toContain('if (!hasExistingCookie || options?.refreshExisting)');
  });

  it('9. scopes guest lookup strictly to the opaque anonymous owner', () => {
    expect(cartService).toContain('where: { anonymousId }');
    expect(cartService).toContain('return { anonymousId: context.anonymousId }');
  });

  it('10. merges the anonymous owner during login', () => {
    expect(authController).toContain('this.authService.mergeCartOnLogin(');
    expect(authController).toContain('cookies?.cartId');
  });

  it('11. reads guest and existing account carts in one merge transaction', () => {
    expect(cartService).toContain('const [anonCart, userCart] = await Promise.all([');
    expect(cartService).toContain('return this.prisma.$transaction(async (tx) =>');
  });

  it('12. merges duplicate variants into one existing line', () => {
    expect(cartService).toContain('existingItemsMap');
    expect(cartService).toContain('data: { qty: mergedQty }');
  });

  it('13. caps merged quantity to real stock', () => {
    expect(cartService).toContain('Math.min(requestedTotalQty, availableStock)');
  });

  it('14. cannot merge the old anonymous cart twice', () => {
    expect(cartService).toContain('await client.cart.delete({ where: { id: anonCart.id } })');
    expect(authController).toContain('clearMergedAnonymousCartCookie(res)');
  });

  it('15. invalidates old anonymous ownership after adoption', () => {
    expect(cartService).toContain('data: { userId, anonymousId: null }');
  });

  it('16. preserves authenticated cart ownership as a guest on logout', () => {
    expect(authService).toContain('async logoutToAnonymousCart(');
    expect(authService).toContain('data: { userId: null, anonymousId }');
  });

  it('17. keeps an available Quick Add size selectable', () => {
    expect(products).toContain('const availableButtons = buttons.filter((btn) => !btn.disabled)');
    expect(products).toContain('activate(firstButton)');
  });

  it('18. disables a zero-stock Quick Add size semantically', () => {
    expect(products).toContain("aria-disabled=\"${unavailable ? 'true' : 'false'}\"");
    expect(products).toContain("${unavailable ? 'disabled' : ''}");
  });

  it('19. gives sold-out Quick Add sizes a dedicated visual state', () => {
    expect(products).toContain("is-unavailable' : ''");
    expect(storeStyles).toContain('.qa-size-btn.is-unavailable::after');
  });

  it('20. prevents Quick Add from adding an unavailable variant', () => {
    expect(products).toContain('if (!isVariantAvailable(variant))');
    expect(products).toContain('if (!btn || btn.disabled) return');
  });

  it('21. never defaults Quick Add to an unavailable size', () => {
    expect(products).toContain('const firstButton = availableButtons[0]');
    expect(products).not.toContain('|| buttons[0]');
  });

  it('22. retains the backend insufficient-stock enforcement', () => {
    expect(cartService).toContain('this.assertStock(newQty, variant.stockQty ?? 0)');
    expect(cartService).toContain('throw new BadRequestException(INSUFFICIENT_STOCK_ERROR)');
  });

  it('23. preserves the collapsed structured ENVIAR A summary', () => {
    expect(checkoutHtml).toContain('id="address-summary"');
    expect(checkoutScript).toContain('addressSummaryEl.replaceChildren(');
  });

  it('24. hides the header-side address summary while ENVIAR A is open', () => {
    expect(checkoutStyles).toContain('#address-details[open] > summary #address-summary');
    expect(cssRule(checkoutStyles, '#address-details[open] > summary #address-summary')).toContain('display: none');
  });

  it('25. preserves the saved-address card in expanded content', () => {
    expect(checkoutHtml).toContain('id="default-address-card" class="default-address"');
    expect(checkoutHtml).toContain('id="saved-address-select-button"');
    expect(checkoutScript).toContain('defaultAddressLinesEl.textContent = display.lines.join');
  });

  it('26. places the different-address action outside the saved-address card', () => {
    expect(checkoutHtml).toMatch(
      /<p id="default-address-lines"><\/p>\s*<\/div>\s*<button id="different-address-button"/,
    );
  });

  it('27. retains the three-dot Edit menu', () => {
    expect(checkoutHtml).toContain('id="address-menu-button"');
    expect(checkoutHtml).toContain('id="edit-address-button"');
    expect(checkoutScript).toContain('editAddressButton?.addEventListener');
  });

  it('28. retains the accessible PATCH edit-address modal', () => {
    expect(checkoutHtml).toContain('role="dialog" aria-modal="true"');
    expect(checkoutScript).toContain("method: 'PATCH'");
    expect(checkoutScript).toContain("event.key !== 'Tab'");
  });

  it('29. removes Configure Cookies from checkout', () => {
    expect(checkoutHtml).not.toContain('data-open-cookie-preferences');
    expect(checkoutHtml).not.toContain('Configurar cookies');
  });

  it('30. removes Configure Cookies from normal storefront footers', () => {
    for (const file of ['index.html', 'cart.html', 'favorites.html', 'profile.html']) {
      expect(readFrontend(file)).not.toContain('data-open-cookie-preferences');
    }
  });

  it('31. leaves no permanent duplicate cookie-settings controls on other pages', () => {
    const pages = readdirSync(frontendRoot).filter((file) => file.endsWith('.html'));
    const triggerCount = pages.reduce(
      (count, file) => count + (readFrontend(file).match(/data-open-cookie-preferences/g)?.length ?? 0),
      0,
    );
    expect(triggerCount).toBe(1);
  });

  it('32. leaves the one permanent control at the end of cookie policy', () => {
    expect(cookiePolicy.match(/data-open-cookie-preferences/g)).toHaveLength(1);
    expect(cookiePolicy).toMatch(
      /Última actualización:[\s\S]*data-open-cookie-preferences[\s\S]*<\/main>/,
    );
  });

  it('33. binds the policy control to the real preferences interface', () => {
    expect(cookieConsent).toContain('openPreferences(event.currentTarget)');
    expect(cookieConsent).toContain('bindPermanentControl()');
  });

  it('34. preserves the initial accept, reject, and configure banner', () => {
    for (const action of ['accept', 'reject', 'configure']) {
      expect(cookieConsent).toContain(`data-consent-action="${action}"`);
    }
    expect(cookieConsent).toContain('if (!current) showBanner()');
  });

  it('35. preserves preference inspection, withdrawal, and saving', () => {
    expect(cookieConsent).toContain('const saveConsent = (selection) =>');
    expect(cookieConsent).toContain('analytics: form.elements["consent-analytics"]?.checked === true');
    expect(cookieConsent).toContain('rejectAll: () => saveConsent(defaultSelection())');
  });

  it('36. makes the checkout left column a normal-flow element', () => {
    expect(cssRule(checkoutStyles, '.checkout-flow-pane')).not.toContain('overflow-y');
  });

  it('37. makes the center only a noninteractive one-pixel divider', () => {
    const rule = cssRule(checkoutStyles, '.checkout-flow-pane');
    expect(rule).toContain('border-right: 1px solid var(--checkout-line)');
    expect(rule).not.toContain('scrollbar');
  });

  it('38. keeps the main document vertically scrollable', () => {
    expect(checkoutStyles).toMatch(
      /body\.page-checkout\s*\{\s*min-height:\s*100dvh;[\s\S]*?overflow-y:\s*auto;/,
    );
  });

  it('39. defines no intentional desktop pane or cart-list scrollbar', () => {
    expect(cssRule(checkoutStyles, '.checkout-summary-pane')).not.toContain('overflow-y');
    expect(cssRule(checkoutStyles, '.checkout-cart__items')).not.toContain('overflow-y');
  });

  it('40. keeps the right summary available with sticky positioning', () => {
    expect(cssRule(checkoutStyles, '.checkout-summary-inner')).toContain('position: sticky');
    expect(cssRule(checkoutStyles, '.checkout-summary-inner')).toContain('top: 0');
  });

  it('41. gives mobile one document flow without nested vertical scrolling', () => {
    const mobile = checkoutStyles.slice(checkoutStyles.indexOf('@media (max-width: 900px)'));
    expect(cssRule(mobile, '.checkout-flow-pane')).toContain('overflow: visible');
    expect(cssRule(mobile, '.checkout-flow-pane')).not.toContain('overflow-y');
    expect(cssRule(mobile, '.checkout-summary-pane')).not.toContain('overflow-y');
    expect(cssRule(mobile, '.checkout-cart__items')).not.toContain('overflow-y');
  });

  it('42. removes the center divider in the one-column mobile layout', () => {
    const mobile = checkoutStyles.slice(checkoutStyles.indexOf('@media (max-width: 900px)'));
    expect(mobile).toMatch(
      /\.checkout-flow-pane,[\s\S]*\.checkout-footer\s*\{[\s\S]*border-right:\s*0;/,
    );
  });

  it('43. left-aligns the compact collapsed address and emphasizes only the name', () => {
    const addressSummary = cssRule(
      checkoutStyles,
      '.checkout-accordion__value.is-address',
    );
    expect(addressSummary).toContain('justify-self: start');
    expect(addressSummary).toContain('text-align: left');
    expect(addressSummary).toContain('width: min(100%, 340px)');
    const addressName = cssRule(
      checkoutStyles,
      '#address-summary.is-address > .address-summary__name',
    );
    expect(addressName).toContain('color: #fff');
    expect(addressName).toContain('font-size: 13px');
    expect(addressName).toContain('font-weight: 700');
    expect(
      cssRule(
        checkoutStyles,
        '#address-summary.is-address > .address-summary__line',
      ),
    ).toContain('font-weight: 400');
    expect(checkoutScript).toContain("'address-summary__name'");
    expect(checkoutScript).toContain("'address-summary__line'");
    expect(checkoutScript).toContain(
      'const lines = [display.name, addressLine, region].filter(Boolean)',
    );
  });

  it('44. anchors both desktop checkout columns toward the center divider', () => {
    expect(cssRule(checkoutStyles, '.checkout-flow-inner')).toContain(
      'margin: 0 0 0 auto',
    );
    expect(cssRule(checkoutStyles, '.checkout-summary-inner')).toContain(
      'margin: 0 auto 0 0',
    );
    const mobile = checkoutStyles.slice(
      checkoutStyles.indexOf('@media (max-width: 900px)'),
    );
    expect(mobile).toMatch(
      /\.checkout-flow-inner,[\s\S]*\.checkout-summary-inner\s*\{[\s\S]*margin:\s*0 auto;/,
    );
  });

  it('45. centers and slightly enlarges the linked logo without moving the cart control', () => {
    const brandbar = cssRule(checkoutStyles, '.checkout-brandbar');
    const brand = cssRule(checkoutStyles, '.checkout-brand');
    expect(checkoutHtml).toMatch(
      /<a href="index\.html" class="checkout-brand"[\s\S]*?<img src="assets\/logo_banner\.png"/,
    );
    expect(brandbar).toContain('position: relative');
    expect(brandbar).toContain('justify-content: flex-end');
    expect(brand).toContain('position: absolute');
    expect(brand).toContain('left: 50%');
    expect(brand).toContain('transform: translateX(-50%)');
    expect(brand).toContain('width: clamp(136px, 13vw, 180px)');
    expect(checkoutHtml).toContain('id="cart-icon-btn"');
  });

  it('46. compacts the right summary without stretching a section into empty space', () => {
    const summaryInner = cssRule(checkoutStyles, '.checkout-summary-inner');
    expect(summaryInner).toContain('grid-template-rows: none');
    expect(summaryInner).toContain('grid-auto-rows: max-content');
    expect(summaryInner).toContain('align-content: start');
    expect(summaryInner).not.toContain('1fr');
    expect(cssRule(checkoutStyles, '.checkout-summary')).toContain('gap: 8px');
  });

  it('47. places the authoritative Spanish tax note directly after total', () => {
    expect(checkoutHtml).toMatch(
      /id="summary-subtotal"[\s\S]*id="summary-shipping"[\s\S]*id="summary-total"[\s\S]*id="summary-tax-note"/,
    );
    expect(checkoutScript).toContain('Number(summary.taxAmount)');
    expect(checkoutScript).toContain(
      'Incluye ${formatMoney(taxAmount)} de impuestos',
    );
    expect(checkoutScript).toContain('data.summary,');
  });

  it('48. presents checkout product thumbnails on white without cropping', () => {
    const media = cssRule(checkoutStyles, '.checkout-item__media');
    const image = cssRule(checkoutStyles, '.checkout-item__media img');
    expect(media).toContain('background: #fff');
    expect(media).toContain('padding: 8px');
    expect(image).toContain('object-fit: contain');
  });

  it('49. keeps only the promo field placeholder and action in the default row', () => {
    const promoStart = checkoutHtml.indexOf('<div class="checkout-promo"');
    const promoEnd = checkoutHtml.indexOf('</div>', promoStart);
    const promoOpening = checkoutHtml.slice(promoStart, promoEnd);
    expect(promoOpening).not.toContain('<h2>');
    expect(checkoutHtml).toContain('placeholder="Código de descuento"');
    expect(checkoutHtml).toContain('id="apply-promo-button"');
    expect(checkoutHtml).toContain('id="promo-status"');
  });

  it('50. removes both borders that created the line below the promo area', () => {
    expect(cssRule(checkoutStyles, '.checkout-promo')).not.toContain(
      'border-bottom',
    );
    expect(cssRule(checkoutStyles, '.checkout-summary')).not.toContain(
      'border-top',
    );
  });

  it('51. never treats unavailable cart data as an empty exclusion set', () => {
    expect(checkoutScript).toContain('hasAuthoritativeRecommendationCart');
    expect(checkoutScript).toContain('hideRecommendations();');
    expect(checkoutScript).not.toContain('cartItems: state.cart?.items || []');
    expect(checkoutScript).toContain(
      'cartItems: authoritativeRecommendationCart.items',
    );
    expect(checkoutScript).toMatch(
      /const loadRecommendations = async[\s\S]*?hideRecommendations\(\);[\s\S]*?!hasAuthoritativeRecommendationCart\(\)/,
    );
  });

  it('52. cancels stale recommendation loads during summary and payment preparation', () => {
    expect(checkoutScript).toContain('let recommendationLoadRevision = 0');
    expect(checkoutScript).toContain(
      'if (loadRevision !== recommendationLoadRevision) return false',
    );
    expect(checkoutScript).toMatch(
      /const refreshCheckoutSummary = async[\s\S]*?recommendationLoadRevision \+= 1;[\s\S]*?hideRecommendations\(\);[\s\S]*?setLoadingState\(true\)/,
    );
    expect(checkoutScript).toContain(
      'recommendationCartRevisionAtRequest ===',
    );
    expect(checkoutScript).toContain(
      'authoritativeRecommendationCartRevision',
    );
  });

  it('53. removes an added recommendation before refreshing checkout totals', () => {
    expect(checkoutScript).toMatch(
      /state\.cart = await addCartItem[\s\S]*?commitAuthoritativeRecommendationCart\(state\.cart\);[\s\S]*?reconcileRecommendationsWithCart\(\);[\s\S]*?await queueCheckoutUpdate\(\);[\s\S]*?loadRecommendations\(\{ force: true \}\)/,
    );
    expect(checkoutScript).toContain(
      "window.addEventListener('cart:updated'",
    );
  });

  it('54. scales the right summary and gives recommendations white contained images', () => {
    const itemMedia = cssRule(checkoutStyles, '.checkout-item__media');
    const recommendationImage = cssRule(
      checkoutStyles,
      '.checkout-recommendation__image',
    );
    expect(itemMedia).toContain('width: 96px');
    expect(itemMedia).toContain('height: 108px');
    expect(recommendationImage).toContain('width: 76px');
    expect(recommendationImage).toContain('height: 86px');
    expect(recommendationImage).toContain('background: #fff');
    expect(recommendationImage).toContain('object-fit: contain');
    expect(cssRule(checkoutStyles, '.checkout-item__title')).toContain(
      'font-size: 16px',
    );
    expect(cssRule(checkoutStyles, '.checkout-item__price')).toContain(
      'font-size: 14px',
    );
    expect(cssRule(checkoutStyles, '.summary-row')).toContain('font-size: 13px');
    expect(cssRule(checkoutStyles, '.summary-total')).toContain('font-size: 17px');
    expect(cssRule(checkoutStyles, '.summary-total strong')).toContain(
      'font-size: 23px',
    );
  });

  it('55. shows the recommendation divider only with visible suggestions and softens Pago exprés', () => {
    const recommendations = cssRule(
      checkoutStyles,
      '.checkout-recommendations',
    );
    const expressTitle = cssRule(
      checkoutStyles,
      '.express-checkout .checkout-kicker',
    );
    expect(recommendations).toContain(
      'border-top: 1px solid var(--checkout-line)',
    );
    expect(checkoutHtml).toMatch(
      /id="checkout-recommendations"[^>]*hidden/,
    );
    expect(checkoutScript).toContain(
      'recommendationsSection.hidden = recommendationsList.children.length === 0',
    );
    expect(expressTitle).toContain('color: rgba(245, 245, 242, 0.56)');
    expect(expressTitle).toContain('font-size: 11px');
    expect(expressTitle).toContain('font-weight: 400');
    expect(expressTitle).toContain('text-transform: none');
  });

  it('56. puts the live cart amount inside the drawer checkout button without a duplicate subtotal row', () => {
    const drawerPages = [
      'cart.html',
      'favorites.html',
      'index.html',
      'producto.html',
      'profile.html',
    ].map(readFrontend);
    drawerPages.forEach((html) => {
      expect(html).toContain(
        'id="cart-checkout-btn" class="btn-primary btn-block">Finalizar compra · —</button>',
      );
      expect(html).not.toContain('id="cart-subtotal"');
    });
    expect(app).toContain('const formatCheckoutButtonMoney = (cents, currency = \'EUR\')');
    expect(app).toContain("currencyDisplay: 'narrowSymbol'");
    expect(app).toContain('return `${amount} ${symbol}`;');
    expect(app).toContain(
      'checkoutBtn.textContent = `Finalizar compra · ${formatCheckoutButtonMoney(',
    );
    expect(app).toContain('subtotalCents,\n        cart?.currency,');
    expect(app).not.toContain("const cartSubtotalEl = $('#cart-subtotal')");
    expect(app).toContain('window.location.href = CHECKOUT_URL');
  });

  it('57. shows every recommendation size compactly and blocks sold-out variants', () => {
    const sizeRule = cssRule(checkoutStyles, '.checkout-recommendation__size');
    const unavailableRule = cssRule(
      checkoutStyles,
      '.checkout-recommendation__size.is-unavailable',
    );
    const strikeRule = cssRule(
      checkoutStyles,
      '.checkout-recommendation__size.is-unavailable::after',
    );
    const actionRule = cssRule(
      checkoutStyles,
      '.checkout-recommendation__action',
    );
    const sizesRule = cssRule(
      checkoutStyles,
      '.checkout-recommendation__sizes',
    );

    expect(checkoutScript).toContain('getProductVariants?.(product)');
    expect(checkoutScript).toContain('data-recommendation-unavailable');
    expect(checkoutScript).toContain("aria-disabled=\"${isAvailable ? 'false' : 'true'}\"");
    expect(checkoutScript).toContain("disabled tabindex=\"-1\"");
    expect(checkoutScript).toContain('selectRecommendationVariant(card, sizeButton)');
    expect(checkoutScript).toMatch(
      /fetchFreshRecommendation\(product\)[\s\S]*?getAvailableRecommendationVariants\(fresh\)[\s\S]*?RECOMMENDATION_VARIANT_OUT_OF_STOCK/,
    );
    expect(sizeRule).toContain('min-width: 22px');
    expect(sizeRule).toContain('height: 20px');
    expect(sizeRule).toContain('padding: 1px 4px');
    expect(sizeRule).toContain('font-size: 9px');
    expect(sizesRule).toContain('gap: 3px');
    expect(sizesRule).toContain('margin-top: 4px');
    expect(unavailableRule).toContain('opacity: 0.38');
    expect(unavailableRule).toContain('text-decoration: none');
    expect(strikeRule).toContain('transform: rotate(-28deg)');
    expect(strikeRule).toContain('height: 1px');
    expect(actionRule).toContain('padding: 6px 9px');
    expect(actionRule).toContain('font-size: 9px');
  });

  it('58. centers the promo controls without moving either existing divider', () => {
    const promoRule = cssRule(checkoutStyles, '.checkout-promo');
    const recommendationsRule = cssRule(
      checkoutStyles,
      '.checkout-recommendations',
    );
    const summaryInnerRule = cssRule(
      checkoutStyles,
      '.checkout-summary-inner',
    );

    expect(promoRule).toContain('padding: 18px 0 6px');
    expect(promoRule).toContain(
      'border-top: 1px solid var(--checkout-line)',
    );
    expect(recommendationsRule).toContain(
      'border-top: 1px solid var(--checkout-line)',
    );
    expect(summaryInnerRule).toContain('gap: 12px');
    expect(checkoutScript).toContain('await API.applyPromoCode({');
    expect(checkoutScript).toContain("applyPromoBtn?.addEventListener('click'");
  });

  it('59. reduces only the vertical gap below the checkout brand bar', () => {
    const brandbarRule = cssRule(checkoutStyles, '.checkout-brandbar');
    expect(brandbarRule).toContain('margin-bottom: clamp(20px, 3vh, 36px)');
    expect(brandbarRule).toContain('justify-content: flex-end');
    expect(cssRule(checkoutStyles, '.checkout-brand')).toContain('left: 50%');
  });

  it('60. recovers an invalid checkout session before reloading and preserves guest ownership', () => {
    const recoveryStart = checkoutScript.indexOf(
      'const recoverInvalidCheckoutSession = async',
    );
    const recoveryEnd = checkoutScript.indexOf(
      'const classifyCheckoutError',
      recoveryStart,
    );
    const recovery = checkoutScript.slice(recoveryStart, recoveryEnd);

    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recovery).toContain("typeof API.logout !== 'function'");
    expect(recovery).toMatch(
      /await API\.logout\(\);[\s\S]*window\.CRONOX_USER = null;[\s\S]*state\.isAuthenticated = false;[\s\S]*window\.location\.reload\(\);/,
    );
    expect(recovery.match(/window\.location\.reload\(\)/g)).toHaveLength(1);
    expect(recovery).toContain('invalidSessionRecoveryInFlight = false');
    expect(checkoutScript).toContain(
      'options.onAction = recoverInvalidCheckoutSession',
    );
    expect(authController).toContain(
      'this.authService.logoutToAnonymousCart(',
    );
    expect(authController).toContain(
      'res.cookie(CART_COOKIE_NAME, anonymousId, getCartCookieOptions())',
    );
    expect(authController).toContain('this.authService.clearAuthCookies(res)');
    expect(authService).toContain(
      'data: { userId: null, anonymousId }',
    );
  });

  it('61. opens the one shared storefront auth modal from checkout', () => {
    const loginHandlerStart = checkoutScript.indexOf(
      'const openLogin = async',
    );
    const loginHandlerEnd = checkoutScript.indexOf(
      "loginCalloutLink?.addEventListener('click', openLogin)",
      loginHandlerStart,
    );
    const loginHandler = checkoutScript.slice(
      loginHandlerStart,
      loginHandlerEnd,
    );

    expect(checkoutHtml).not.toContain('id="authOverlay"');
    expect(app).toContain("const AUTH_HTML_PATH = 'auth-modal.html'");
    expect(app).toContain('const openAuthModal = async');
    expect(app).toContain('const ready = await prepareAuthExperience()');
    expect(checkoutScript).toContain(
      "await window.CRONOX_openAuthModal('login')",
    );
    expect(loginHandler).not.toContain('window.location.href');
    expect(authModal).toContain('id="authLoginForm"');
    expect(authModal).toContain('id="authRegisterForm"');
    expect(authModal).toContain('data-auth-forgot');
    expect(app).toContain("window.location.href = 'forgot-password.html'");
    expect(app).toContain('authReturnFocus = activeElement');
    expect(app).toContain("returnFocus.focus({ preventScroll: true })");
  });

  it('62. keeps login on checkout and refreshes cart, customer, address and checkout state', () => {
    expect(app).toContain('const user = await window.CRONOX_API.login({ email, password })');
    expect(app).toContain(
      "window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user }))",
    );
    expect(authController).toContain('this.authService.mergeCartOnLogin(');
    expect(checkoutScript).toMatch(
      /window\.addEventListener\('cronox:userChanged'[\s\S]*renderCustomerContact\(user\);[\s\S]*await loadUserShippingDefaults\(\);[\s\S]*await queueCheckoutUpdate\(\);/,
    );
    expect(checkoutScript).toMatch(
      /else \{[\s\S]*await renderGuestCheckout\(\);[\s\S]*await loadRecommendations\(\);/,
    );
  });

  it('63. formats only zero-cost shipping as GRATIS everywhere checkout displays it', () => {
    expect(checkoutScript).toContain(
      "Number.isFinite(amount) && amount === 0 ? 'GRATIS' : formatEuro(cents)",
    );
    expect(checkoutScript).toContain(
      '${formatShippingPrice(priceCents)}</span>',
    );
    expect(checkoutScript).toContain(
      '[selected.label, selected.description, formatShippingPrice(priceCents)]',
    );
    expect(checkoutScript).toContain(
      'const shippingPrice = formatShippingPrice(totals.shippingCents)',
    );
    expect(checkoutScript).not.toContain(
      '${shippingMethod.label} · ${formatEuro(totals.shippingCents)}',
    );
  });

  it('64. renders checkout recommendation sizes closed with no automatic selection', () => {
    expect(checkoutScript).toContain(
      'class="checkout-recommendation__sizes" role="group" aria-label="Tallas para ${productName}" hidden',
    );
    expect(checkoutScript).toContain(
      'aria-controls="${selectorId}" aria-expanded="false"',
    );
    expect(checkoutScript).toContain(
      "article.dataset.recommendationVariant = ''",
    );
    expect(checkoutScript).toContain('aria-pressed="false"');
    expect(checkoutScript).not.toContain('directVariant');
    expect(
      cssRule(checkoutStyles, '.checkout-recommendation__sizes[hidden]'),
    ).toContain('display: none !important');
  });

  it('65. uses Añadir as an explicit two-step recommendation action', () => {
    const handlerStart = checkoutScript.indexOf(
      'const handleRecommendationAdd = async',
    );
    const handlerEnd = checkoutScript.indexOf(
      'const renderShippingOptions',
      handlerStart,
    );
    const handler = checkoutScript.slice(handlerStart, handlerEnd);

    expect(handler).toMatch(
      /activeRecommendationCard !== card \|\| selector\?\.hidden[\s\S]*openRecommendationSelector\(card, \{ focusFirst \}\);[\s\S]*return;/,
    );
    expect(handler).toMatch(
      /const selectedVariantId[\s\S]*if \(!selectedVariantId\)[\s\S]*Selecciona una talla\.[\s\S]*return;[\s\S]*await addRecommendationVariant/,
    );
  });

  it('66. selecting a recommendation size only stores one visual selection', () => {
    const selectStart = checkoutScript.indexOf(
      'const selectRecommendationVariant =',
    );
    const selectEnd = checkoutScript.indexOf(
      'const fetchFreshRecommendation',
      selectStart,
    );
    const selection = checkoutScript.slice(selectStart, selectEnd);

    expect(selection).toContain(
      "card.querySelectorAll('[data-recommendation-variant]').forEach",
    );
    expect(selection).toContain("button.classList.toggle('is-selected', selected)");
    expect(selection).toContain("button.setAttribute('aria-pressed', selected ? 'true' : 'false')");
    expect(selection).toContain('card.dataset.recommendationVariant =');
    expect(selection).not.toContain('addCartItem');
  });

  it('67. revalidates and adds exactly one selected recommendation only on the second action', () => {
    expect(checkoutScript).toContain('const pendingRecommendationAdds = new Set()');
    expect(checkoutScript).toContain('pendingRecommendationAdds.has(productKey)');
    expect(checkoutScript).toMatch(
      /fetchFreshRecommendation\(product\)[\s\S]*getAvailableRecommendationVariants\(fresh\)[\s\S]*await addCartItem\(\{ variantId: variant\.id, qty: 1 \}\)/,
    );
    expect(checkoutScript).toMatch(
      /card\.dataset\.recommendationVariant = '';[\s\S]*closeRecommendationSelector\(\);[\s\S]*await queueCheckoutUpdate\(\);[\s\S]*await loadRecommendations\(\{ force: true \}\);[\s\S]*Producto añadido\./,
    );
    expect(checkoutScript).toContain('pendingRecommendationAdds.delete(productKey)');
  });

  it('68. keeps one accessible recommendation selector open at a time', () => {
    expect(checkoutScript).toContain('let activeRecommendationCard = null');
    expect(checkoutScript).toMatch(
      /activeRecommendationCard && activeRecommendationCard !== card[\s\S]*closeRecommendationSelector\(\)/,
    );
    expect(checkoutScript).toContain("addButton.setAttribute('aria-expanded', 'true')");
    expect(checkoutScript).toContain("addButton?.setAttribute('aria-expanded', 'false')");
    expect(checkoutScript).toMatch(
      /const closeRecommendationSelector[\s\S]*card\.dataset\.recommendationVariant = '';[\s\S]*button\.classList\.remove\('is-selected'\);[\s\S]*aria-pressed', 'false'/,
    );
    expect(checkoutScript).toContain('!activeRecommendationCard.contains(event.target)');
    expect(checkoutScript).toContain(
      'closeRecommendationSelector({ restoreFocus: true })',
    );
  });
});
