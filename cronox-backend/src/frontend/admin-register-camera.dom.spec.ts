import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const front = join(__dirname, '../../../cronox-front');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve }; };
const option = (variantId = 13, lotId: string | null = 'old') => ({ productId: 7, variantId, lotId, size: variantId === 13 ? 'M' : 'L', name: 'CORE TEE', stock: 9, unitPriceCents: 2300 });
const ok = (data: any) => ({ ok: true, json: async () => data });
const fail = (message: string) => ({ ok: false, status: 409, json: async () => ({ message }) });

async function setup() {
  const dom = new JSDOM(readFileSync(join(front, 'admin.html'), 'utf8'), { url: 'https://cronox.test/admin.html', runScripts: 'outside-only' });
  const w = dom.window as any;
  const root = w.document.querySelector('#section-register'); root.hidden = false;
  w.CRONOX_API = { getCsrfHeaders: async () => ({}) };
  w.CRONOX_SECURITY = { productImageUrl: () => '' };
  w.CRONOX_AFTER_SALES = { canLeave: () => true, status: () => ({}), hasPending: () => false, leave() {} };
  let scanner: any;
  w.CRONOX_REGISTER_CAMERA = { stop: jest.fn(), start: jest.fn((config: any) => { scanner = config; }) };
  w.fetch = jest.fn(async (url: string, init: any) => {
    if (url.endsWith('/barcode')) return ok([option()]);
    const body = JSON.parse(init.body);
    const items = body.items.map((line: any) => ({ ...option(line.variantId, line.lotId), ...line, subtotalCents: line.quantity * 2300 }));
    return ok({ items, units: items.reduce((n: number, l: any) => n + l.quantity, 0), totalCents: items.reduce((n: number, l: any) => n + l.subtotalCents, 0), revision: 'rev', point: null, customer: null });
  });
  w.eval(readFileSync(join(front, 'assets/admin-register.js'), 'utf8'));
  const click = async (act: string) => { root.querySelector(`[data-act="${act}"]`).click(); await flush(); };
  w.CRONOX_REGISTER.open(); await click('purchase'); await click('no-event'); await click('guest'); await click('camera');
  const scan = (code = 'CRL0000000001') => scanner.onRead(code, { center: { x: .3, y: .4 } });
  const feedback = () => root.querySelector('#register-feedback');
  const units = () => root.querySelector('#register-ticket footer span').textContent;
  const markers = () => [...root.querySelectorAll('.register-camera-result')];
  const posts = (path: string) => w.fetch.mock.calls.filter(([url]: any[]) => url.endsWith('/' + path));
  return { dom, w, root, click, scan, feedback, units, markers, posts, scanner: () => scanner, close: () => dom.window.close() };
}

describe('Caja: resultados y sesiones de cámara sobre la incorporación real al ticket', () => {
  it('confirma ambos verdes solo después del quote; conserva tirada y una unidad', async () => {
    const t = await setup();
    try {
      const wait = deferred(); const original = t.w.fetch.getMockImplementation();
      t.w.fetch.mockImplementation((url: string, init: any) => url.endsWith('/quote') ? wait.promise : original(url, init));
      const task = t.scan(); await flush();
      expect(t.markers()).toHaveLength(0); expect(t.units()).toContain('0 uds.');
      expect(JSON.parse(t.posts('quote').at(-1)[1].body).items).toEqual([{ variantId: 13, lotId: 'old', quantity: 1 }]);
      wait.resolve(ok({ items: [{ ...option(), quantity: 1, subtotalCents: 2300 }], units: 1, totalCents: 2300, revision: 'r' }));
      await task;
      expect(t.feedback().textContent).toBe('Prenda aceptada');
      expect(t.feedback().classList.contains('register-success')).toBe(true);
      expect(t.feedback().querySelector('svg')).not.toBeNull();
      expect(t.markers()[0].classList.contains('register-success')).toBe(true);
      expect(t.markers()[0].style.left).toContain('30%');
      expect(t.units()).toContain('1 uds.');
    } finally { t.close(); }
  });
  it('bloquea simultáneas, alias de código y otra tirada del mismo producto/talla; admite otra talla', async () => {
    const t = await setup();
    try {
      const original = t.w.fetch.getMockImplementation();
      t.w.fetch.mockImplementation((url: string, init: any) => url.endsWith('/barcode') ? ok([option(JSON.parse(init.body).code.endsWith('3') ? 14 : 13, JSON.parse(init.body).code.endsWith('2') ? 'new' : 'old')]) : original(url, init));
      await Promise.all([t.scan(), t.scan(), t.scan('CRX0000000002'), t.scan('CRL0000000003')]);
      expect(t.units()).toContain('2 uds.'); expect(t.posts('barcode')).toHaveLength(3);
      expect(t.markers()).toHaveLength(2);
      const quoteCount = t.posts('quote').length;
      await t.scan(); await t.scan();
      expect(t.posts('quote')).toHaveLength(quoteCount);
      expect(t.feedback().textContent).not.toBe('Prenda aceptada');
      expect(t.posts('barcode')).toHaveLength(3);
    } finally { t.close(); }
  });
  it.each(['Código de prenda desconocido.', 'Disponibles: 0 · CORE TEE, talla M.'])('muestra ambos rojos y permite reintentar: %s', async message => {
    const t = await setup();
    try {
      const original = t.w.fetch.getMockImplementation(); let failed = false;
      t.w.fetch.mockImplementation((url: string, init: any) => {
        if (!failed && url.endsWith(message.startsWith('Código') ? '/barcode' : '/quote')) { failed = true; return fail(message); }
        return original(url, init);
      });
      await t.scan();
      expect(t.units()).toContain('0 uds.');
      expect(t.feedback().textContent).toBe(message.replace(/\.$/, ''));
      expect(t.markers()[0].classList.contains('register-error')).toBe(true);
      await t.scan();
      expect(t.units()).toContain('1 uds.'); expect(t.feedback().textContent).toBe('Prenda aceptada');
      expect(t.feedback().classList.contains('register-error')).toBe(false);
    } finally { t.close(); }
  });
  it('conserva sesión al cambiar cámara y reinicia al cerrar sin perder el ticket; manual sigue añadiendo', async () => {
    const t = await setup();
    try {
      await t.scan();
      const sessionRead = t.scanner();
      t.w.CRONOX_REGISTER.open(); await flush();
      expect(t.scanner()).toBe(sessionRead);
      const devices = t.root.querySelector('[data-devices]');
      devices.dispatchEvent(new t.w.Event('change', { bubbles: true })); await flush();
      await t.scan(); expect(t.units()).toContain('1 uds.');
      await t.click('close-camera'); expect(t.markers()).toHaveLength(0); expect(t.feedback().textContent).toBe('');
      await t.click('camera'); await t.scan(); expect(t.units()).toContain('2 uds.');
      const form = t.root.querySelector('[data-form=code]'); form.elements.code.value = 'CRL0000000001';
      form.dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true })); await flush();
      expect(t.units()).toContain('3 uds.');
    } finally { t.close(); }
  });
  it.each(['barcode', 'quote'])('descarta una respuesta tardía de %s tras cerrar/reabrir rápidamente', async path => {
    const t = await setup();
    try {
      const wait = deferred(); const original = t.w.fetch.getMockImplementation(); let intercepted = false;
      t.w.fetch.mockImplementation((url: string, init: any) => {
        if (!intercepted && url.endsWith('/' + path)) { intercepted = true; return wait.promise; }
        return original(url, init);
      });
      const staleScanner = t.scanner(); const old = t.scan(); await flush();
      await t.click('close-camera'); await t.click('camera'); const fresh = t.scan(); await flush();
      wait.resolve(path === 'barcode' ? ok([option()]) : ok({ items: [{ ...option(), quantity: 1 }], units: 1, totalCents: 2300 }));
      await Promise.all([old, fresh]);
      expect(t.units()).toContain('1 uds.'); expect(t.markers()).toHaveLength(1);
      await staleScanner.onRead('CRL0000000002'); staleScanner.onError('Error antiguo');
      expect(t.feedback().textContent).toBe('Prenda aceptada');
      await t.scan(); expect(t.units()).toContain('1 uds.');
    } finally { t.close(); }
  });
  it('un código antiguo permite elegir tirada sin elegir otra silenciosamente', async () => {
    const t = await setup();
    try {
      const original = t.w.fetch.getMockImplementation();
      t.w.fetch.mockImplementation((url: string, init: any) => url.endsWith('/barcode') ? ok([option(), option(13, 'new')]) : original(url, init));
      await t.scan('CRX0000000001'); expect(t.units()).toContain('0 uds.'); expect(t.markers()).toHaveLength(0);
      const buttons = t.root.querySelectorAll('[data-act=lot]'); buttons[1].click(); await flush();
      expect(t.units()).toContain('1 uds.'); expect(t.feedback().textContent).toBe('Prenda aceptada');
      expect(JSON.parse(t.posts('quote').at(-1)[1].body).items[0].lotId).toBe('new');
      await t.scan('CRX0000000002'); expect(t.units()).toContain('1 uds.');
    } finally { t.close(); }
  });
});

describe('Recurso de cámara', () => {
  async function setupCamera(fallback = false) {
    const dom = new JSDOM('<video></video><select></select>', { url: 'https://cronox.test', runScripts: 'outside-only' });
    const w = dom.window as any;
    let decoded: any, sequence = 0;
    const jobs = new Map<number, () => void>();
    w.setTimeout = (fn: () => void) => { jobs.set(++sequence, fn); return sequence; };
    w.clearTimeout = (id: number) => jobs.delete(id);
    const stop = jest.fn();
    Object.defineProperty(w, 'isSecureContext', { value: true });
    Object.defineProperty(w.navigator, 'mediaDevices', { value: {
      getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop }], getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'rear' }) }] })),
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'rear' }],
    } });
    const video = w.document.querySelector('video'); video.play = async () => {}; video.pause = jest.fn();
    Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } });
    w.BarcodeDetector = fallback ? undefined : class { static async getSupportedFormats() { return ['code_128']; } async detect() { return decoded ? [decoded] : []; } };
    if (fallback) {
      w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
      w.CRONOX_QR_READER = { createReader: jest.fn(async () => ({ decodeResultFromCanvas: async () => decoded })) };
    }
    w.eval(readFileSync(join(front, 'assets/admin-register-camera.js'), 'utf8'));
    const onRead = jest.fn(), onError = jest.fn();
    const start = () => w.CRONOX_REGISTER_CAMERA.start({ video, devices: w.document.querySelector('select'), format: 'code_128', onRead, onError });
    const frame = async () => { const job = [...jobs][0]; if (job) { jobs.delete(job[0]); job[1](); } await flush(); };
    return { w, dom, onRead, onError, start, frame, stop, jobs, show: (value: any) => decoded = value };
  }
  it('suprime presencia repetida, sigue decodificando con una incorporación pendiente y limpia recursos', async () => {
    const t = await setupCamera();
    try {
      const wait = deferred(); t.onRead.mockImplementation(() => wait.promise);
      t.show({ rawValue: 'CRX0000000001', boundingBox: { x: 64, y: 48, width: 128, height: 96 } });
      await t.start(); await flush();
      expect(t.onRead.mock.calls[0][1].center).toEqual({ x: .2, y: .2 });
      for (let i = 0; i < 12; i++) await t.frame(); expect(t.onRead).toHaveBeenCalledTimes(1);
      t.show({ rawValue: 'CRL0000000002' }); await t.frame(); expect(t.onRead).toHaveBeenCalledTimes(2);
      t.show(null); for (let i = 0; i < 5; i++) await t.frame();
      t.show({ rawValue: 'CRX0000000001' }); await t.frame(); expect(t.onRead).toHaveBeenCalledTimes(3);
      t.w.CRONOX_REGISTER_CAMERA.stop(); expect(t.stop).toHaveBeenCalledTimes(1); expect(t.jobs.size).toBe(0);
      expect(t.w.document.querySelector('video').srcObject).toBeNull(); wait.resolve(undefined);
    } finally { t.dom.window.close(); }
  });
  it('usa el lector Code128 local cuando no hay detector nativo y conserva sus coordenadas', async () => {
    const t = await setupCamera(true);
    try {
      t.show({ text: 'CRL0000000001', position: { topLeft: { x: 64, y: 48 }, bottomRight: { x: 192, y: 144 } } });
      await t.start(); await flush();
      expect(t.w.CRONOX_QR_READER.createReader).toHaveBeenCalledWith('Code128');
      expect(t.onRead.mock.calls[0][1].center).toEqual({ x: .2, y: .2 });
      expect(t.onError).not.toHaveBeenCalled(); t.w.CRONOX_REGISTER_CAMERA.stop();
    } finally { t.dom.window.close(); }
  });
});
