import { JSDOM } from 'jsdom';
import { cartAbandonedDocument, CART_COPY } from './cart-abandoned-design';
import { renderMail } from './mail-renderer';
import { composeGlobalMailFooter } from '../mail-global-footer';
import { containedOrderImage } from './order-product-image';
import { purchasableReminderItems } from '../../cart/cart-abandonment.service';

describe('approved abandoned basket design', () => {
  it.each([1, 2, 3, 4, 5])('renders the exact copy and one shared footer for circle %i', circle => {
    const items = [[400, 800], [800, 400], [500, 500]].map(([width, height], i) => ({ name: `Prenda ${i + 1}`, variantName: 'M', quantity: 2, imageUrl: `https://example.test/${i}.png`, ...containedOrderImage(width, height), lineTotalFormatted: '45,00 €' }));
    const rendered = renderMail(cartAbandonedDocument(), CART_COPY.subject, CART_COPY.preheader, 'CART_ABANDONED', { circleLevel: circle, items, actionUrl: 'https://example.test/cesta' }, { blocks: [{ type: 'text', text: 'Firma que no debe aparecer' }] }, true);
    const content = composeGlobalMailFooter(rendered.html, rendered.text, { preferenceUrl: 'https://example.test/preferencias' });
    const doc = new JSDOM(content.html).window.document;
    expect(rendered.subject).toBe('¿Te quedaste con las ganas?');
    for (const text of [CART_COPY.preheader, CART_COPY.title, CART_COPY.message, CART_COPY.selection, CART_COPY.action, CART_COPY.note]) expect(doc.body.textContent).toContain(text);
    for (const text of [CART_COPY.title, CART_COPY.message, CART_COPY.selection, CART_COPY.action, CART_COPY.note]) expect(content.text).toContain(text);
    expect(doc.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
    expect(doc.querySelectorAll('a[href="https://example.test/preferencias"]')).toHaveLength(1);
    expect(content.html + content.text).not.toMatch(/carrito|Dejar de recibir|CRONOX · cronox.es|Firma que no debe/);
    const rows = [...doc.querySelectorAll('.cart-mail-product')]; expect(rows).toHaveLength(3);
    expect(rows.every(row => row.getAttribute('style')!.includes('background:transparent'))).toBe(true);
    const frames = [...doc.querySelectorAll<HTMLTableElement>('.cart-mail-thumbnail')];
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect([frame.width, frame.getAttribute('height')]).toEqual(['70', '70']);
      expect(frame.style.width).toBe('70px'); expect(frame.style.height).toBe('70px');
      const cell = frame.querySelector('td')!;
      expect(cell.getAttribute('bgcolor')).toBeNull();
      expect(cell.style.backgroundColor).toBe('');
      expect(cell.getAttribute('align')).toBe('center'); expect(cell.getAttribute('valign')).toBe('middle');
    }
    const images = rows.map(row => row.querySelector('img')!);
    expect(images.map(img => [img.getAttribute('width'), img.getAttribute('height')])).toEqual([['70', '70'], ['70', '70'], ['70', '70']]);
    expect(images.every(img => !img.getAttribute('style')!.includes('object-fit'))).toBe(true);
  });
  it('uses stored photo dimensions in real reminder data without changing quantity or eligibility', () => {
    const cart: any = { items: [{ qty: 2, lotAtAdd: 'lot', variant: { isActive: true, stockQty: 2, price: 2500, size: 'M', product: { id: 42, name: 'Prenda', isActive: true, currency: 'EUR', activeLotId: 'lot', price: 2500, inventoryLots: [], images: [{ url: 'https://example.test/photo.png', width: 400, height: 800 }] } } }] };
    expect(purchasableReminderItems(cart)[0]).toMatchObject({ imageWidth: 70, imageHeight: 70, quantity: 2, imageUrl: 'https://cronox.es/api/email/order-product-image/cart/42.png?v=1' });
  });
});
