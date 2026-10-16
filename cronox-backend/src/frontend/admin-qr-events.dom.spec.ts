import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const front = join(__dirname, '../../../cronox-front');
const source = readFileSync(join(front, 'assets/admin-qr-events.js'), 'utf8');
const html = readFileSync(join(front, 'admin.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const deferred = () => { let resolve: (value: any) => void = () => {}; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
const group = (id: string) => ({ id, name: 'Evento ' + id, description: '', total: 0 });
const participant = { id: 'p1', publicUserId: 'stable-user-1', qrIdentifier: 'opaque-public-token', name: 'Daniel Rivas', circleAtRegistration: 2, registeredAt: '2026-10-16T10:00:00Z', registeredBy: { publicUserId: 'admin-id', name: 'Admin' } };
const ok = (data: any) => ({ ok: true, json: async () => data });

function setup(id = 'a') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://cronox.test/admin.html#section-qr-events?group=${id}` });
  const w = dom.window as any;
  w.document.getElementById('section-qr-events').hidden = false;
  w.CRONOX_API = { API_BASE: '', getCsrfHeaders: jest.fn(async () => ({ 'X-CSRF-Token': 'csrf' })) };
  const tracks: any[] = [];
  const makeStream = () => {
    const track = { stop: jest.fn(), addEventListener: jest.fn(), getSettings: () => ({ deviceId: 'rear' }) };
    tracks.push(track); return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: jest.fn(async () => makeStream()), enumerateDevices: jest.fn(async () => [{ kind: 'videoinput', deviceId: 'rear', label: 'Trasera' }, { kind: 'videoinput', deviceId: 'front', label: 'Frontal' }]) } });
  const video = w.document.getElementById('qrEventsVideo');
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 640 }, videoHeight: { value: 480 } });
  video.play = jest.fn(async () => {}); video.pause = jest.fn();
  let decoded = '';
  const detect = jest.fn(async () => decoded ? [{ rawValue: decoded }] : []);
  w.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } detect = detect; };
  w.fetch = jest.fn(async (url: string, options: any) => {
    if (options.method === 'POST') return ok({ status: 'registered', groupId: id, participant, total: 1 });
    const match = url.match(/qr-events\/([^/]+)\/participants/);
    return ok(match ? { group: group(match[1]), items: [], total: 0, page: 1, limit: 25, pages: 1 } : { items: [group(id)], total: 1, page: 1, limit: 25, pages: 1 });
  });
  w.eval(source);
  const el = (suffix: string) => w.document.getElementById('qrEvents' + suffix);
  const scan = async (value: string) => { decoded = value; el('CameraOpen').click(); await flush(); };
  const close = () => { w.CRONOX_QR_EVENTS.leave(); dom.window.close(); };
  const posts = () => w.fetch.mock.calls.filter(([, options]: any[]) => options.method === 'POST');
  return { dom, w, tracks, makeStream, detect, el, scan, close, posts };
}

describe('Eventos QR camera, session and request lifecycles', () => {
  it('shows a confirmed result only after persistence and suppresses repeated frames without leaking raw QR', async () => {
    const t = setup(), pending = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(() => pending.promise);
      await t.scan('CRX1.secret-public-token');
      expect(t.posts()).toHaveLength(1);
      expect(t.el('ScanMessage').textContent).toContain('Comprobando');
      expect(t.el('ScanMessage').textContent).not.toContain('Registrado');
      pending.resolve(ok({ status: 'registered', groupId: 'a', participant, total: 1 })); await flush();
      expect(t.el('ScanMessage').textContent).toContain('Registrado: Daniel Rivas');
      await new Promise(resolve => setTimeout(resolve, 190));
      expect(t.posts()).toHaveLength(1);
      expect(t.posts()[0][1].headers['X-CSRF-Token']).toBe('csrf');
      expect(t.posts()[0][1].credentials).toBe('include');
      expect(t.el('ScanMessage').textContent).not.toContain('secret-public-token');
    } finally { t.close(); }
  });

  it('freezes a scan to the original group and ignores its result after navigating', async () => {
    const t = setup(), pending = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(() => pending.promise); await t.scan('CRX1.A');
      t.w.location.hash = '#section-qr-events?group=b'; await t.w.CRONOX_QR_EVENTS.load();
      pending.resolve(ok({ status: 'registered', groupId: 'a', participant, total: 99 })); await flush();
      expect(t.posts()[0][0]).toContain('/a/scan');
      expect(t.el('GroupName').textContent).toBe('Evento b');
      expect(t.el('Total').textContent).not.toContain('99');
      expect(t.el('ScanMessage').textContent).toBe('');
      expect(t.tracks[0].stop).toHaveBeenCalled();
    } finally { t.close(); }
  });

  it('stops a stream arriving after permission was canceled, without attaching it', async () => {
    const t = setup(), media = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.navigator.mediaDevices.getUserMedia.mockImplementation(() => media.promise);
      t.el('CameraOpen').click(); await flush();
      expect(t.el('CameraMessage').textContent).toContain('pendiente');
      expect(t.el('CameraStop').disabled).toBe(false);
      t.el('CameraStop').click(); const stream = t.makeStream(); media.resolve(stream); await flush();
      expect(t.tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(t.el('Video').srcObject).toBeNull();
      expect(t.el('Scanner').hidden).toBe(true);
    } finally { t.close(); }
  });

  it('keeps a pending browser permission bounded and releases a later stream', async () => {
    const t = setup(), media = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      let expire: (() => void) | undefined;
      const schedule = t.w.setTimeout.bind(t.w);
      t.w.setTimeout = (callback: () => void, delay: number) => {
        if (delay === 30000) { expire = callback; return 99999; }
        return schedule(callback, delay);
      };
      t.w.navigator.mediaDevices.getUserMedia.mockImplementation(() => media.promise);
      t.el('CameraOpen').click(); await flush(); expire?.();
      expect(t.el('CameraOpen').disabled).toBe(false);
      expect(t.el('CameraMessage').textContent).toContain('sigue pendiente');
      media.resolve(t.makeStream()); await flush();
      expect(t.tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(t.el('Video').srcObject).toBeNull();
    } finally { t.close(); }
  });

  it.each([
    ['NotAllowedError', 'Permiso de cámara denegado'],
    ['NotFoundError', 'No se encontró esa cámara'],
    ['NotReadableError', 'Cámara ocupada'],
  ])('makes %s camera errors recoverable', async (name, text) => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(Object.assign(new Error(name), { name }));
      t.el('CameraOpen').click(); await flush();
      expect(t.el('CameraMessage').textContent).toContain(text);
      expect(t.el('CameraOpen').disabled).toBe(false);
      expect(t.el('CameraStop').disabled).toBe(true);
      expect(t.posts()).toHaveLength(0);
      t.el('CameraOpen').click(); await flush();
      expect(t.el('CameraMessage').textContent).toContain('Cámara abierta');
    } finally { t.close(); }
  });

  it('explains an insecure origin without requesting camera access', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      Object.defineProperty(t.w, 'isSecureContext', { value: false });
      t.el('CameraOpen').click(); await flush();
      expect(t.el('CameraMessage').textContent).toContain('HTTPS o localhost');
      expect(t.w.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    } finally { t.close(); }
  });

  it('retries uncertain writes idempotently without claiming success or changing destination', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async () => { throw new TypeError('network'); });
      await t.scan('CRX1.A');
      expect(t.el('ScanMessage').textContent).toContain('Puede haberse guardado');
      expect(t.el('ScanRetry').hidden).toBe(false);
      expect(t.el('Total').textContent).toBe('0 participantes');
      expect(t.tracks[0].stop).toHaveBeenCalled();
      t.w.fetch.mockImplementationOnce(async () => ok({ status: 'already_registered', groupId: 'a', participant, total: 1 }));
      t.el('ScanRetry').click(); await flush();
      expect(t.posts()).toHaveLength(2);
      expect(t.posts()[0][1].body).toBe(t.posts()[1][1].body);
      expect(t.el('ScanMessage').textContent).toContain('Ya registrado en este grupo');
    } finally { t.close(); }
  });

  it.each([
    [400, 'INVALID_QR', 'QR no válido o desconocido'],
    [422, 'CREDENTIAL_UNUSABLE', 'Credencial no utilizable'],
    [404, 'GROUP_UNAVAILABLE', 'Grupo no disponible'],
    [403, '', 'Permiso insuficiente'],
  ])('distinguishes scan error %s / %s without adding a row', async (status, code, text) => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async () => ({ ok: false, status, json: async () => ({ code }) }));
      await t.scan('https://untrusted.example/private');
      expect(t.el('ScanMessage').textContent).toContain(text);
      expect(t.el('Participants').children.length).toBe(0);
      expect(t.el('Total').textContent).toBe('0 participantes');
      expect(t.w.fetch.mock.calls.every(([url]: any[]) => url.startsWith('/api/admin/qr-events'))).toBe(true);
    } finally { t.close(); }
  });

  it('uses the packaged decoder without BarcodeDetector and requests video only', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.BarcodeDetector = undefined;
      const drawImage = jest.fn(), decode = jest.fn(async () => 'CRX1.fallback');
      t.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage });
      t.w.CRONOX_QR_READER = { createReader: async () => ({ decodeFromCanvas: decode }) };
      await t.scan('');
      expect(drawImage).toHaveBeenCalled(); expect(decode).toHaveBeenCalled();
      expect(t.posts()[0][1].body).toContain('CRX1.fallback');
      expect(t.w.navigator.mediaDevices.getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    } finally { t.close(); }
  });

  it('falls back when the native detector exists but cannot decode QR and frees video on section exit', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.BarcodeDetector.getSupportedFormats = async () => ['ean_13'];
      const decode = jest.fn(async () => undefined);
      t.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: jest.fn() });
      t.w.CRONOX_QR_READER = { createReader: async () => ({ decodeFromCanvas: decode }) };
      await t.scan('');
      expect(decode).toHaveBeenCalled(); expect(t.detect).not.toHaveBeenCalled();
      t.w.document.getElementById('section-qr-events').hidden = true; await flush();
      expect(t.tracks[0].stop).toHaveBeenCalled();
      expect(t.el('Video').srcObject).toBeNull();
    } finally { t.close(); }
  });

  it('releases camera tracks on switch, session ending and reopening', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load(); await t.scan('');
      expect(t.el('CameraLabel').hidden).toBe(false);
      t.el('CameraChoice').value = 'front'; t.el('CameraChoice').dispatchEvent(new t.w.Event('change')); await flush();
      expect(t.tracks[0].stop).toHaveBeenCalled();
      expect(t.w.navigator.mediaDevices.getUserMedia.mock.calls[1][0].video.deviceId.exact).toBe('front');
      t.w.dispatchEvent(new t.w.CustomEvent('cronox:session-ended'));
      expect(t.tracks[1].stop).toHaveBeenCalled(); expect(t.el('Video').srcObject).toBeNull();
    } finally { t.close(); }
  });

  it('renders names as text and preserves stable complete identifiers in Madrid time', async () => {
    const t = setup();
    try {
      t.w.fetch.mockResolvedValueOnce(ok({ group: group('a'), items: [{ ...participant, name: '<img src=x onerror=alert(1)>' }], total: 1, page: 1, limit: 25, pages: 1 }));
      await t.w.CRONOX_QR_EVENTS.load();
      expect(t.el('Participants').querySelector('img')).toBeNull();
      expect(t.el('Participants').textContent).toContain('stable-user-1');
      expect(t.el('Participants').textContent).toContain('opaque-public-token');
      expect(t.el('Participants').textContent).toContain('12:00:00');
    } finally { t.close(); }
  });
});
