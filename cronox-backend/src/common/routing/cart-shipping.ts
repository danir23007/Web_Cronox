import { FREE_SHIPPING_THRESHOLD_CENTS, type ShippingMethodOption } from '../../shipping-methods/shipping-methods.service';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
const money = (cents: number) => new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'}).format(cents / 100);

// The initial rows represent active configuration, before the private cart quote.
// They use the same DOM and sizes as hydration, preserving the existing layout.
export function renderCartShipping(html: string, methods: ShippingMethodOption[]): string {
  const controls = methods.map((method, index) => `<label class="shipping-option">
    <input type="radio" name="shippingMethod" value="${escapeHtml(method.code)}" ${index === 0 ? 'checked' : ''}>
    <div class="shipping-option__info"><span class="shipping-option__label">${escapeHtml(method.label)}</span>${method.code === 'STANDARD' ? `<small class="shipping-option__helper">Gratis a partir de ${escapeHtml(money(FREE_SHIPPING_THRESHOLD_CENTS))}</small>` : ''}</div>
    <span class="shipping-option__price" data-code="${escapeHtml(method.code)}">${escapeHtml(money(method.amountCents))}</span>
  </label>`).join('\n');
  return html.replace(/<!-- cart-shipping:start -->[\s\S]*?<!-- cart-shipping:end -->/, `<!-- cart-shipping:start -->${controls || '<p role="status">No hay métodos de envío disponibles.</p>'}<!-- cart-shipping:end -->`);
}
