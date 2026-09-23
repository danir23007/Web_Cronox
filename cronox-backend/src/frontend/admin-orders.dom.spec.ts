import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const frontendRoot = join(__dirname, '..', '..', '..', 'cronox-front');
const read = (path: string) => readFileSync(join(frontendRoot, path), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('admin order fulfillment detail', () => {
  it('renders saved fulfillment data as text and shows explicit fallbacks', async () => {
    const dom = new JSDOM(read('admin.html'), {
      runScripts: 'outside-only',
      url: 'https://admin.cronox.test/admin.html',
    });
    const window = dom.window as any;
    const detail = {
      id: 42,
      status: 'PAID',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'NOT_SHIPPED',
      customer: {
        name: '<img id="unsafe-customer" src=x>',
        email: 'guest@example.test',
        phone: null,
      },
      shippingAddress: {
        recipient: 'Ada Lovelace',
        line1: 'Calle Mayor 10',
        line2: '2º B',
        postalCode: '28013',
        city: 'Madrid',
        province: 'Madrid',
        country: 'España',
      },
      shippingMethod: { code: 'STANDARD', label: 'Envío estándar 24/72h' },
      shippingCost: '4.95',
      shippingCarrier: 'Transportista manual',
      trackingNumber: 'TRACK-42',
      trackingUrl: 'https://tracking.example/TRACK-42',
      internalNote: 'Preparar con cuidado',
      items: [
        {
          title: '<script id="unsafe-item">alert(1)</script> Camiseta (M)',
          variant: 'M',
          quantity: 2,
          lineTotal: '20.00',
        },
      ],
    };
    window.CRONOX_API = {
      API_BASE: '',
      formatPrice: (value: number) => `${value.toFixed(2)} €`,
    };
    window.fetch = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(
          url.endsWith('/42') ? detail : { data: [{ id: 42, status: 'PAID' }] },
        ),
    }));

    window.eval(read('assets/admin-orders.js'));
    await window.fetchOrders();
    window.document.querySelector('button[data-order-id="42"]')?.click();
    await flush();
    await flush();

    expect(
      window.document.getElementById('orderCustomerName')?.textContent,
    ).toBe('<img id="unsafe-customer" src=x>');
    expect(window.document.getElementById('unsafe-customer')).toBeNull();
    expect(
      window.document.getElementById('orderCustomerPhone')?.textContent,
    ).toBe('No disponible');
    expect(
      window.document.getElementById('orderAddressLine1')?.textContent,
    ).toBe('Calle Mayor 10');
    expect(
      window.document.getElementById('orderShippingMethod')?.textContent,
    ).toBe('Envío estándar 24/72h (STANDARD)');
    expect(
      window.document.getElementById('orderShippingCost')?.textContent,
    ).toBe('4.95 €');
    expect(
      window.document.querySelector('#orderItemsBody tr')?.textContent,
    ).toContain('<script id="unsafe-item">alert(1)</script> Camiseta (M)');
    expect(window.document.getElementById('unsafe-item')).toBeNull();
    expect(
      window.document.getElementById('orderTrackingNumber'),
    ).toHaveProperty('value', 'TRACK-42');
    expect(window.document.getElementById('orderInternalNote')).toHaveProperty(
      'value',
      'Preparar con cuidado',
    );
  });
});
