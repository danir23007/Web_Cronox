import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontend = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(frontend, file), 'utf8');
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const publicUrl = 'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=PQ123456789ES';
const trackingFixture = () => ({
  revision: 3,
  number: 'PQ123456789ES',
  publicUrl,
  state: null,
  apiEnabled: true,
  contractReady: false,
  lastSuccessAt: '2026-10-14T10:00:00Z',
  lastError: { code: 'TRACKING_RATE_LIMITED', at: '2026-10-14T10:05:00Z' },
  nextSyncAt: null,
  events: [{ id: 'one', occurredAt: null, occurredLocalAt: '14/10/2026 11:00:00', code: 'RAW', description: '<img id="unsafe-tracking" src=x>', category: null }],
  audit: [{ createdAt: '2026-10-14T09:00:00Z', previousNumber: 'OLD12345', nextNumber: 'PQ123456789ES', revision: 3 }],
  label: { fileName: 'etiqueta.pdf', updatedAt: '2026-10-14T09:05:00Z', trackingRevision: 3 },
});
const detail = { id: 42, status: 'PAID', shippingCarrier: 'Correos', trackingNumber: 'PQ123456789ES', trackingRevision: 3, trackingUrl: publicUrl, items: [] };
const setupAdmin = (tracking: Record<string, unknown> = trackingFixture()) => {
  const dom = new JSDOM(read('admin.html'), { runScripts: 'outside-only', url: 'https://fixture.test/admin.html' });
  const win = dom.window as any;
  win.CRONOX_API = { API_BASE: '', getCsrfHeaders: async () => ({ 'x-csrf-token': 'fixture' }) };
  win.confirm = jest.fn(() => true);
  win.CRONOX_SECURITY = { externalHttpUrl: (value: string) => /^https?:\/\//.test(value || '') ? value : '' };
  win.fetch = jest.fn(async (url: string, _options: unknown) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(url.endsWith('/tracking') ? tracking : url.endsWith('/42') ? detail : { items: [detail] }),
  }));
  win.eval(read('assets/user-identity.js'));
  win.eval(read('assets/admin-orders.js'));
  return { dom, win };
};

describe('Correos order tracking presentation', () => {
  it('keeps order and tracking identifiers separate, renders literal events safely and separates query errors', async () => {
    const { dom, win } = setupAdmin();
    try {
      await win.CRONOX_ADMIN_ORDERS.open(42);
      expect(win.document.querySelector('#orderDetailNumber').textContent).toBe('42');
      expect(win.document.querySelector('#orderTrackingNumber').value).toBe('PQ123456789ES');
      expect(win.document.querySelector('#orderTrackingState').textContent).toContain('admisión no confirmada');
      expect(win.document.querySelector('#orderTrackingLastSuccess').textContent).not.toContain('Sin sincronización');
      expect(win.document.querySelector('#orderTrackingError').textContent).toContain('TRACKING_RATE_LIMITED');
      const event = win.document.querySelector('#orderTrackingEvents');
      expect(event.textContent).toContain('14/10/2026 11:00:00');
      expect(event.textContent).toContain('<img id="unsafe-tracking" src=x>');
      expect(event.querySelector('time')).toBeNull();
      expect(win.document.querySelector('#unsafe-tracking')).toBeNull();
      expect(event.textContent).not.toContain('TRACKING_RATE_LIMITED');
      expect(win.document.querySelector('#orderTrackingPublicLink').href).toBe(publicUrl);
      expect(win.document.querySelector('#orderTrackingSyncBtn').disabled).toBe(false);
      expect(win.document.querySelector('#orderTrackingContract').hidden).toBe(false);
    } finally { dom.window.close(); }
  });

  it('honors server cooldown, permits private label download while API is disabled and flags a superseded label', async () => {
    const tracking = { ...trackingFixture(), apiEnabled: false, nextSyncAt: new Date(Date.now() + 60000).toISOString(), label: { ...trackingFixture().label, trackingRevision: 2 } };
    const { dom, win } = setupAdmin(tracking);
    try {
      await win.CRONOX_ADMIN_ORDERS.open(42);
      expect(win.document.querySelector('#orderTrackingSyncBtn').disabled).toBe(true);
      expect(win.document.querySelector('#orderTrackingApi').hidden).toBe(false);
      expect(win.document.querySelector('#orderLabelDownloadBtn').disabled).toBe(false);
      expect(win.document.querySelector('#orderLabelStale').hidden).toBe(false);
    } finally { dom.window.close(); }
  });

  it('uses the manual cooldown rather than the later automatic schedule', async () => {
    const tracking = { ...trackingFixture(), manualAvailableAt: new Date(Date.now() - 1000).toISOString(), nextSyncAt: new Date(Date.now() + 1800000).toISOString() };
    const { dom, win } = setupAdmin(tracking);
    try {
      await win.CRONOX_ADMIN_ORDERS.open(42);
      expect(win.document.querySelector('#orderTrackingSyncBtn').disabled).toBe(false);
      expect(win.document.querySelector('#orderTrackingNextManual').textContent).not.toBe('—');
    } finally { dom.window.close(); }
  });

  it('locks sync for unsaved identifiers and sends the current revision when saving a replacement', async () => {
    const { dom, win } = setupAdmin();
    try {
      await win.CRONOX_ADMIN_ORDERS.open(42);
      const input = win.document.querySelector('#orderTrackingNumber');
      input.value = 'PQ999999999ES';
      input.dispatchEvent(new win.Event('input'));
      expect(win.document.querySelector('#orderTrackingSyncBtn').disabled).toBe(true);
      expect(win.document.querySelector('#orderTrackingMessage').textContent).toContain('Guarda los cambios');
      win.document.querySelector('#orderSaveBtn').click();
      await flush();
      const save = win.fetch.mock.calls.find(([url]: string[]) => url.endsWith('/fulfillment'));
      expect(JSON.parse(save[1].body)).toMatchObject({ trackingNumber: 'PQ999999999ES', trackingRevision: 3 });
    } finally { dom.window.close(); }
  });

  it('ignores a previous order tracking response after another order is opened', async () => {
    const { dom, win } = setupAdmin();
    let finishOld!: (value: unknown) => void;
    win.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/42/tracking')) return new Promise((resolve) => { finishOld = resolve; });
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(url.endsWith('/tracking')
          ? { ...trackingFixture(), number: 'NEW12345', events: [] }
          : { ...detail, id: url.endsWith('/43') ? 43 : 42, trackingNumber: 'NEW12345' }),
      };
    });
    try {
      const first = win.CRONOX_ADMIN_ORDERS.open(42);
      await flush();
      await win.CRONOX_ADMIN_ORDERS.open(43);
      finishOld({ ok: true, status: 200, text: async () => JSON.stringify({ ...trackingFixture(), state: 'OLD-SHIPMENT' }) });
      await first;
      expect(win.document.querySelector('#orderDetailNumber').textContent).toBe('43');
      expect(win.document.querySelector('#orderTrackingState').textContent).not.toBe('OLD-SHIPMENT');
      expect(win.document.querySelector('#orderTrackingNumber').value).toBe('NEW12345');
    } finally { dom.window.close(); }
  });

  it('uploads only a PDF with a revision and CSRF token, without a JSON multipart content type', async () => {
    const { dom, win } = setupAdmin();
    try {
      await win.CRONOX_ADMIN_ORDERS.open(42);
      const input = win.document.querySelector('#orderLabelFile');
      Object.defineProperty(input, 'files', { configurable: true, value: [new win.File(['%PDF-fixture'], 'etiqueta.pdf', { type: 'application/pdf' })] });
      input.dispatchEvent(new win.Event('change'));
      win.document.querySelector('#orderLabelUploadBtn').click();
      await flush();
      const upload = win.fetch.mock.calls.find(([url]: string[]) => url.endsWith('/label'));
      expect(upload[1].body).toBeInstanceOf(win.FormData);
      expect(upload[1].body.get('revision')).toBe('3');
      expect(upload[1].headers['Content-Type']).toBeUndefined();
      expect(upload[1].headers['x-csrf-token']).toBe('fixture');
      expect(upload[1].credentials).toBe('include');
    } finally { dom.window.close(); }
  });

  it.each(['https://api1.correos.es/support/trackpub/api/v2/search/123', 'https://www.correos.es.evil.test/track/123', 'javascript:alert(1)'])(
    'does not expose a private API or untrusted link: %s', async (value) => {
      const { dom, win } = setupAdmin({ ...trackingFixture(), publicUrl: value });
      try {
        await win.CRONOX_ADMIN_ORDERS.open(42);
        expect(win.document.querySelector('#orderTrackingPublicLink').hidden).toBe(true);
        expect(win.document.querySelector('#orderTrackingPublicLink').hasAttribute('href')).toBe(false);
      } finally { dom.window.close(); }
    },
  );

  it('renders customer pending, cancelled, refunded, local and delivered orders coherently with an enduring public link', async () => {
    const dom = new JSDOM('<table><tbody id="ordersBody"></tbody></table><p id="ordersEmpty"></p>', { runScripts: 'outside-only', url: 'https://fixture.test/profile.html' });
    const win = dom.window as any;
    win.CRONOX_SECURITY = { externalHttpUrl: (value: string) => /^https?:\/\//.test(value || '') ? value : '' };
    win.CRONOX_API = {
      getMe: async () => ({ firstName: 'Fixture', circleLevel: 1 }),
      getMyOrders: async () => [
        { id: 1, status: 'PAID' },
        { id: 2, status: 'CANCELLED' },
        { id: 3, status: 'REFUNDED' },
        { id: 4, status: 'PAID', shippingMethodCode: 'LOCAL_PICKUP' },
        { id: 5, status: 'PAID', shippingRequired: false },
        { id: 6, status: 'DELIVERED', shippingCarrier: 'Correos', trackingNumber: 'PQ123456789ES', trackingUrl: publicUrl },
        { id: 7, status: 'SHIPPED' },
      ],
    };
    try {
      win.eval(read('assets/profile.js'));
      await flush();
      const rows = [...win.document.querySelectorAll('#ordersBody tr')] as HTMLElement[];
      expect(rows).toHaveLength(7);
      expect(rows[0].querySelector('[data-label="Seguimiento"]')?.textContent).toBe('Pendiente de enviar');
      expect(rows[1].textContent).toContain('Pedido cancelado');
      expect(rows[2].textContent).toContain('Pedido reembolsado');
      expect(rows[3].textContent).toContain('Recogida local');
      expect(rows[4].textContent).toContain('Sin envío');
      expect(rows[5].querySelector('[data-label="Pedido"]')?.textContent).toBe('#6');
      expect(rows[5].querySelector('a')?.textContent).toBe('Ver seguimiento');
      expect(rows[5].querySelector('a')?.href).toBe(publicUrl);
      expect(rows[6].textContent).toContain('Enviado; seguimiento no disponible');
    } finally { dom.window.close(); }
  });
});
