import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const front = join(__dirname, '../../../cronox-front');
const source = readFileSync(join(front, 'assets/admin-qr-events.js'), 'utf8');
const html = readFileSync(join(front, 'admin.html'), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve: (value: any) => void = () => {}; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
const group = (id: string) => ({ id, name: 'Evento ' + id, description: '', total: 0 });
const participant = { id: 'p1', userId: 10, identityUid: 'stable-user-1', qrIdentifier: 'opaque-public-token', name: 'Daniel Rivas', circleAtRegistration: 2, registeredAt: '2026-10-16T10:00:00Z', registeredBy: { id: 2, identityUid: 'admin-id', name: 'Admin' } };
const ok = (data: any) => ({ ok: true, json: async () => data });

// A window-local clock keeps camera frames and exact feedback durations deterministic.
// Promise turns remain real, so an artificially slow response can resolve independently.
function clock(w: any) {
  let now = 1_000_000, sequence = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  const callbacks: { delay: number; callback: () => void }[] = [];
  w.Date.now = () => now;
  Object.defineProperty(w.performance, 'now', { value: () => now });
  w.setTimeout = (callback: () => void, delay = 0) => {
    const id = ++sequence;
    jobs.set(id, { at: now + Number(delay), callback });
    callbacks.push({ delay: Number(delay), callback });
    return id;
  };
  w.clearTimeout = (id: number) => jobs.delete(id);
  const tick = async (milliseconds: number) => {
    const target = now + milliseconds;
    for (;;) {
      const next = [...jobs].filter(([, job]) => job.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].at; jobs.delete(next[0]); next[1].callback(); await flush();
    }
    now = target; await flush();
  };
  return { tick, callbacks };
}

function setup(id = 'a') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://cronox.test/admin.html#section-qr-events?group=${id}` });
  const w = dom.window as any;
  const time = clock(w);
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
  let decoded: string | undefined;
  const detect = jest.fn(async () => decoded === undefined ? [] : [{ rawValue: decoded }]);
  w.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } detect = detect; };
  w.fetch = jest.fn(async (url: string, options: any) => {
    if (options.method === 'POST') return ok({ status: 'registered', groupId: id, participant, total: 1 });
    const match = url.match(/qr-events\/([^/]+)\/participants/);
    return ok(match ? { group: group(match[1]), items: [], total: 0, page: 1, limit: 25, pages: 1 } : { items: [group(id)], total: 1, page: 1, limit: 25, pages: 1 });
  });
  w.eval(source);
  const el = (suffix: string) => w.document.getElementById('qrEvents' + suffix);
  const scan = async (value?: string) => { decoded = value; el('CameraOpen').click(); await flush(); };
  const show = (value?: string) => { decoded = value; };
  const close = () => { w.CRONOX_QR_EVENTS.leave(); dom.window.close(); };
  const posts = () => w.fetch.mock.calls.filter(([, options]: any[]) => options.method === 'POST');
  return { dom, w, tracks, makeStream, detect, el, scan, show, close, posts, ...time };
}

describe('Eventos QR camera, session and request lifecycles', () => {
  it.each(['local', 'other-tab', 'return'])('refreshes removed participants, counts and Excel availability on %s invalidation', async signal => {
    const t = setup();
    try {
      let removed = false;
      t.w.fetch.mockImplementation(async () => ok({ group: { ...group('a'), total: removed ? 0 : 1 }, items: removed ? [] : [participant], total: removed ? 0 : 1, page: 1, limit: 25, pages: 1 }));
      await t.w.CRONOX_QR_EVENTS.load(); await flush();
      expect(t.el('Participants').textContent).toContain(participant.name);
      expect(t.el('Export').disabled).toBe(false);
      removed = true;
      if (signal === 'local') t.w.dispatchEvent(new t.w.Event('cronox:qr-participations-changed'));
      else if (signal === 'other-tab') t.w.dispatchEvent(new t.w.StorageEvent('storage', { key: 'cronox:qr-participations-revision', newValue: 'opaque-revision' }));
      else { Object.defineProperty(t.w.document, 'hidden', { value: false, configurable: true }); t.w.document.dispatchEvent(new t.w.Event('visibilitychange')); }
      await flush();
      expect(t.el('Participants').children).toHaveLength(0);
      expect(t.el('Total').textContent).toContain('0 participantes');
      expect(t.el('Export').disabled).toBe(true);
    } finally { t.close(); }
  });
  it('stops scanning an event deleted elsewhere, explains the state and retains the return-to-list action', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ code: 'GROUP_UNAVAILABLE' }) });
      await t.scan('CRX1.deleted-group-token');
      expect(t.el('ScanMessage').textContent).toContain('eliminado');
      expect(t.el('CameraOpen').disabled).toBe(true);
      expect(t.el('ScanRetry').hidden).toBe(true);
      expect(t.el('Back').hidden).toBe(false);
      expect(t.tracks[0].stop).toHaveBeenCalled();
      await t.tick(5000); expect(t.posts()).toHaveLength(1);
    } finally { t.close(); }
  });
  it('shows a confirmed result only after persistence and suppresses repeated frames without leaking raw QR', async () => {
    const t = setup(), pending = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(() => pending.promise);
      await t.scan('CRX1.secret-public-token');
      expect(t.posts()).toHaveLength(1);
      expect(t.el('ScanMessage').textContent).toContain('Comprobando');
      expect(t.el('ScanMessage').textContent).not.toContain('Registrado');
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(4500);
      expect(t.posts()).toHaveLength(1);
      expect(t.detect.mock.calls.length).toBeGreaterThan(2);
      pending.resolve(ok({ status: 'registered', groupId: 'a', participant, total: 1 })); await flush();
      expect(t.el('ScanResultText').textContent).toBe('aprobado');
      expect(t.el('ScanResult').dataset.result).toBe('registered');
      expect(t.el('ScanResult').hidden).toBe(false);
      await t.tick(999);
      expect(t.el('ScanResult').hidden).toBe(false);
      await t.tick(1);
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(5000);
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
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(6000);
      expect(t.posts()).toHaveLength(1);
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
      expect(t.tracks[0].stop).not.toHaveBeenCalled();
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(6000);
      expect(t.posts()).toHaveLength(1);
      t.w.fetch.mockImplementationOnce(async () => ok({ status: 'already_registered', groupId: 'a', participant, total: 1 }));
      t.el('ScanRetry').click(); await flush();
      expect(t.posts()).toHaveLength(2);
      expect(t.posts()[0][1].body).toBe(t.posts()[1][1].body);
      expect(t.el('ScanResultText').textContent).toBe('ya registrado');
    } finally { t.close(); }
  });

  it('keeps the request timeout active until the JSON body finishes, not only until headers arrive', async () => {
    const t = setup();
    let bodyStarted = false, bodyAborted = false, lateBody: (value: any) => void = () => {};
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async (_url: string, options: any) => ({
        ok: true,
        json: () => {
          bodyStarted = true;
          return new Promise((resolve, reject) => {
            lateBody = resolve;
            options.signal.addEventListener('abort', () => {
              bodyAborted = true;
              reject(new t.w.DOMException('The response body was aborted', 'AbortError'));
            }, { once: true });
          });
        },
      }));
      await t.scan('QR-body-timeout');
      expect(bodyStarted).toBe(true);
      await t.tick(14999);
      expect(bodyAborted).toBe(false);
      expect(t.el('ScanRetry').hidden).toBe(true);
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(1);
      expect(bodyAborted).toBe(true);
      expect(t.el('ScanRetry').hidden).toBe(false);
      expect(t.el('ScanMessage').textContent).toContain('Puede haberse guardado');
      expect(t.el('Scanner').hidden).toBe(false);
      expect(t.posts()).toHaveLength(1);
      lateBody({ status: 'registered', groupId: 'a', participant, total: 99 }); await flush();
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('Total').textContent).toBe('0 participantes');
    } finally { t.close(); }
  });

  it('propagates camera stop to a pending JSON body and discards any late body result', async () => {
    const t = setup(), body = deferred();
    let bodyStarted = false, bodySignal: AbortSignal | undefined;
    const aborted = jest.fn();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async (_url: string, options: any) => ({
        ok: true,
        json: () => {
          bodyStarted = true; bodySignal = options.signal;
          options.signal.addEventListener('abort', aborted, { once: true });
          // Deliberately resolve after cancellation to model a late adapter callback.
          return body.promise;
        },
      }));
      await t.scan('QR-body-stop');
      expect(bodyStarted).toBe(true);
      expect(bodySignal?.aborted).toBe(false);
      t.el('CameraStop').click(); await flush();
      expect(bodySignal?.aborted).toBe(true);
      expect(aborted).toHaveBeenCalledTimes(1);
      body.resolve({ status: 'registered', groupId: 'a', participant, total: 99 }); await flush();
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('Total').textContent).toBe('0 participantes');
      expect(t.el('Participants').children.length).toBe(0);
      expect(t.el('Scanner').hidden).toBe(true);
      expect(t.el('ScanRetry').hidden).toBe(true);
      await t.scan(); await t.tick(15000);
      expect(t.el('CameraMessage').textContent).toContain('Cámara abierta');
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.posts()).toHaveLength(1);
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
      await t.w.CRONOX_QR_EVENTS.load(); await t.scan();
      expect(t.el('CameraLabel').hidden).toBe(false);
      t.el('CameraChoice').value = 'front'; t.el('CameraChoice').dispatchEvent(new t.w.Event('change')); await flush();
      expect(t.tracks[0].stop).toHaveBeenCalled();
      expect(t.w.navigator.mediaDevices.getUserMedia.mock.calls[1][0].video.deviceId.exact).toBe('front');
      t.w.dispatchEvent(new t.w.CustomEvent('cronox:session-ended'));
      expect(t.tracks[1].stop).toHaveBeenCalled(); expect(t.el('Video').srcObject).toBeNull();
    } finally { t.close(); }
  });

  it('renders the actual numeric account ID first, QR last, names as text and historical Madrid time', async () => {
    const t = setup();
    try {
      t.w.fetch.mockResolvedValueOnce(ok({ group: group('a'), items: [{ ...participant, name: '<img src=x onerror=alert(1)>' }], total: 1, page: 1, limit: 25, pages: 1 }));
      await t.w.CRONOX_QR_EVENTS.load();
      expect(t.el('Participants').querySelector('img')).toBeNull();
      const cells = [...t.el('Participants').querySelectorAll('td')].map((cell: any) => cell.textContent);
      expect(cells).toEqual(['10', '<img src=x onerror=alert(1)>', 'II', expect.stringContaining('12:00:00'), 'Admin', 'opaque-public-token']);
      expect(t.el('Participants').textContent).not.toContain('stable-user-1');
    } finally { t.close(); }
  });

  it.each([
    ['already_registered', 'ya registrado', 2000],
    ['invalid', 'no válido', 2000],
  ])('shows %s (%s) for its exact duration without stopping the camera', async (result, label, duration) => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async () => result === 'invalid'
        ? { ok: false, status: 400, json: async () => ({ code: 'INVALID_QR' }) }
        : ok({ status: result, groupId: 'a', participant, total: 1 }));
      await t.scan('QR-A');
      expect(t.el('ScanResult').dataset.result).toBe(result);
      expect(t.el('ScanResultText').textContent).toBe(label);
      expect(t.el('ScanResult').hidden).toBe(false);
      await t.tick(Number(duration) - 1);
      expect(t.el('ScanResult').hidden).toBe(false);
      await t.tick(1);
      expect(t.el('ScanResult').hidden).toBe(true);
      await t.tick(4000);
      expect(t.posts()).toHaveLength(1);
      expect(t.tracks[0].stop).not.toHaveBeenCalled();
      expect(t.el('Scanner').hidden).toBe(false);
    } finally { t.close(); }
  });

  it('observes absence during feedback and rearms a removed QR, but not a brief undecodable frame', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load(); await t.scan('QR-A');
      t.show(); await t.tick(320); t.show('QR-A'); await t.tick(2000);
      expect(t.posts()).toHaveLength(1);
      t.show(); await t.tick(960); t.show('QR-A'); await t.tick(160);
      expect(t.posts()).toHaveLength(2);
      expect(t.posts()[0][1].body).toBe(t.posts()[1][1].body);
      expect(t.tracks[0].stop).not.toHaveBeenCalled();
    } finally { t.close(); }
  });

  it('accepts a different presented QR after feedback, with a single request at a time', async () => {
    const t = setup(), pending = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(() => pending.promise); await t.scan('QR-A');
      t.show('QR-B'); await t.tick(2000);
      expect(t.posts()).toHaveLength(1);
      pending.resolve(ok({ status: 'registered', groupId: 'a', participant, total: 1 })); await flush();
      await t.tick(999); expect(t.posts()).toHaveLength(1);
      await t.tick(161); expect(t.posts()).toHaveLength(2);
      expect(JSON.parse(t.posts()[1][1].body).qrContent).toBe('QR-B');
    } finally { t.close(); }
  });

  it('keeps searching when no QR is decoded, but marks decoded empty content invalid', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load(); await t.scan(); await t.tick(5000);
      expect(t.posts()).toHaveLength(0);
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('ScanMessage').textContent).not.toContain('no válido');
      t.show(''); await t.tick(160);
      expect(t.el('ScanResultText').textContent).toBe('no válido');
      expect(t.el('ScanResult').dataset.result).toBe('invalid');
      expect(t.el('ScanResult').hidden).toBe(false);
      expect(t.posts()).toHaveLength(0);
    } finally { t.close(); }
  });

  it.each([400, 401, 403, 404, 429, 500])('never presents technical HTTP %s as a decoded invalid QR', async status => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(async () => ({ ok: false, status, json: async () => ({}) }));
      await t.scan('QR-A');
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('ScanMessage').dataset.state).toBe('error');
      expect(t.el('ScanMessage').textContent).not.toMatch(/no válido|aprobado/);
      expect(t.el('Participants').children.length).toBe(0);
      await t.tick(4000); expect(t.posts()).toHaveLength(1);
      if ([401, 403, 404].includes(status)) expect(t.tracks[0].stop).toHaveBeenCalled();
    } finally { t.close(); }
  });

  it.each([
    { status: 'registered', groupId: 'another-group', participant, total: 1 },
    { status: 'registered', groupId: 'a', participant: { ...participant, userId: undefined }, total: 1 },
    { status: 'unknown', groupId: 'a', participant, total: 1 },
    { status: 'registered', groupId: 'a', participant, total: 'not-confirmed' },
  ])('does not approve an unconfirmed server response %#', async response => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockResolvedValueOnce(ok(response));
      await t.scan('QR-A');
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('ScanMessage').dataset.state).toBe('error');
      expect(t.el('Participants').children.length).toBe(0);
      expect(t.el('ScanRetry').hidden).toBe(false);
      expect(t.el('Total').textContent).toBe('0 participantes');
    } finally { t.close(); }
  });

  it('reports decoder failure as technical and allows opening the camera again', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.BarcodeDetector = undefined;
      const decode = jest.fn().mockRejectedValueOnce(new Error('Canvas unavailable')).mockResolvedValue(undefined);
      t.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: jest.fn() });
      t.w.CRONOX_QR_READER = { createReader: async () => ({ decodeFromCanvas: decode }) };
      await t.scan();
      expect(t.el('CameraMessage').textContent).toContain('No se pudo leer');
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.posts()).toHaveLength(0);
      expect(t.el('CameraOpen').disabled).toBe(false);
      t.el('CameraOpen').click(); await flush();
      expect(t.el('CameraMessage').textContent).toContain('Cámara abierta');
    } finally { t.close(); }
  });

  it('invalidates an old feedback timeout before a subsequent scan after camera restart', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load(); await t.scan('QR-A');
      const previous = [...t.callbacks].reverse().find(timer => timer.delay === 1000)?.callback;
      expect(previous).toBeDefined();
      t.el('CameraStop').click();
      expect(t.el('ScanResult').hidden).toBe(true);
      t.w.fetch.mockImplementationOnce(async () => ok({ status: 'already_registered', groupId: 'a', participant, total: 1 }));
      await t.scan('QR-B');
      previous?.(); await flush();
      expect(t.el('ScanResult').hidden).toBe(false);
      expect(t.el('ScanResultText').textContent).toBe('ya registrado');
      await t.tick(1999); expect(t.el('ScanResult').hidden).toBe(false);
      await t.tick(1); expect(t.el('ScanResult').hidden).toBe(true);
    } finally { t.close(); }
  });

  it.each(['stop', 'leave'])('ignores an old response after %s, including its UI feedback', async action => {
    const t = setup(), pending = deferred();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementationOnce(() => pending.promise); await t.scan('QR-A');
      if (action === 'stop') t.el('CameraStop').click(); else t.w.CRONOX_QR_EVENTS.leave();
      pending.resolve(ok({ status: 'registered', groupId: 'a', participant, total: 99 })); await flush();
      expect(t.el('ScanResult').hidden).toBe(true);
      expect(t.el('Total').textContent).not.toContain('99');
      expect(t.el('Scanner').hidden).toBe(true);
      await t.tick(5000);
      expect(t.posts()).toHaveLength(1);
    } finally { t.close(); }
  });

  it('refreshes confirmed participants and the total without interrupting the same camera stream', async () => {
    const t = setup();
    try {
      await t.w.CRONOX_QR_EVENTS.load();
      t.w.fetch.mockImplementation(async (_url: string, options: any) => options.method === 'POST'
        ? ok({ status: 'registered', groupId: 'a', participant, total: 1 })
        : ok({ group: { ...group('a'), total: 1 }, items: [participant], total: 1, page: 1, pages: 1, limit: 25 }));
      await t.scan('QR-A');
      expect(t.el('Total').textContent).toBe('1 participantes');
      expect(t.el('Participants').querySelector('td').textContent).toBe('10');
      expect(t.el('Scanner').hidden).toBe(false);
      expect(t.tracks).toHaveLength(1);
      expect(t.tracks[0].stop).not.toHaveBeenCalled();
      expect(t.w.fetch.mock.calls.some(([url]: any[]) => url.includes('/participants?'))).toBe(true);
    } finally { t.close(); }
  });

  it('does not invent a numeric ID for an old participant whose account relation is gone', async () => {
    const t = setup();
    try {
      t.w.fetch.mockResolvedValueOnce(ok({ group: { ...group('a'), total: 1 }, items: [{ ...participant, userId: null, deleted: true, name: '', qrIdentifier: null }], total: 1, page: 1, limit: 25, pages: 1 }));
      await t.w.CRONOX_QR_EVENTS.load();
      const cells = [...t.el('Participants').querySelectorAll('td')].map((cell: any) => cell.textContent);
      expect(cells[0]).not.toMatch(/\d|stable-user|p1/);
      expect(cells[0].length).toBeGreaterThan(0);
      expect(cells[2]).toBe('II');
      expect(cells[3]).toContain('12:00:00');
    } finally { t.close(); }
  });
});

describe('Eventos QR complete-group Excel download', () => {
  const loaded = (total = 51) => ({ group: { ...group('a'), total }, items: total ? [participant] : [], total, page: 2, limit: 25, pages: 3 });
  function download(t: ReturnType<typeof setup>) {
    const clicks: { href: string; download: string }[] = [];
    t.w.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push({ href: this.href, download: this.download }); };
    t.w.URL.createObjectURL = jest.fn(() => 'blob:qr-ids');
    t.w.URL.revokeObjectURL = jest.fn();
    const blob = new t.w.Blob(['fixture-xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const response = { ok: true, headers: { get: (key: string) => key.toLowerCase() === 'content-disposition' ? 'attachment; filename="eventos-qr-prueba-ids.xlsx"' : blob.type }, blob: async () => blob };
    return { clicks, blob, response };
  }

  it('downloads the complete group independently from pagination/search, with loading and duplicate-click protection', async () => {
    const t = setup(), pending = deferred();
    try {
      t.w.fetch.mockResolvedValueOnce(ok(loaded())); await t.w.CRONOX_QR_EVENTS.load();
      t.el('ParticipantSearch').value = 'Daniel';
      const file = download(t);
      t.w.fetch.mockImplementationOnce(() => pending.promise);
      t.el('Export').click(); await flush();
      expect(t.el('Export').disabled).toBe(true);
      expect(t.el('ExportMessage').textContent).toMatch(/gener|descarg|prepar/i);
      t.el('Export').click();
      const requests = t.w.fetch.mock.calls.filter(([url]: any[]) => url.includes('ids.xlsx'));
      expect(requests).toHaveLength(1);
      expect(requests[0][0]).toBe('/api/admin/qr-events/a/ids.xlsx');
      expect(requests[0][1]).toMatchObject({ method: 'GET', credentials: 'include' });
      pending.resolve(file.response); await flush();
      expect(file.clicks).toEqual([{ href: 'blob:qr-ids', download: 'eventos-qr-prueba-ids.xlsx' }]);
      expect(t.w.URL.createObjectURL).toHaveBeenCalledWith(file.blob);
      expect(t.el('Export').disabled).toBe(false);
    } finally { t.close(); }
  });

  it('disables Excel for an empty group and explains why', async () => {
    const t = setup();
    try {
      t.w.fetch.mockResolvedValueOnce(ok(loaded(0))); await t.w.CRONOX_QR_EVENTS.load();
      expect(t.el('Export').disabled).toBe(true);
      expect(t.el('ExportMessage').textContent).toMatch(/no hay participantes/i);
      t.el('Export').click();
      expect(t.w.fetch.mock.calls.some(([url]: any[]) => url.includes('ids.xlsx'))).toBe(false);
    } finally { t.close(); }
  });

  it('makes export failure visible and re-enables retry', async () => {
    const t = setup();
    try {
      t.w.fetch.mockResolvedValueOnce(ok(loaded())); await t.w.CRONOX_QR_EVENTS.load();
      const file = download(t);
      t.w.fetch.mockImplementationOnce(async () => { throw new TypeError('offline'); });
      t.el('Export').click(); await flush();
      expect(t.el('ExportMessage').dataset.state).toBe('error');
      expect(t.el('ExportMessage').textContent.length).toBeGreaterThan(10);
      expect(file.clicks).toHaveLength(0);
      expect(t.el('Export').disabled).toBe(false);
    } finally { t.close(); }
  });

  it('aborts and ignores a late export after leaving the group', async () => {
    const t = setup(), pending = deferred();
    try {
      t.w.fetch.mockResolvedValueOnce(ok(loaded())); await t.w.CRONOX_QR_EVENTS.load();
      const file = download(t);
      t.w.fetch.mockImplementationOnce(() => pending.promise);
      t.el('Export').click(); await flush();
      const request = t.w.fetch.mock.calls.find(([url]: any[]) => url.includes('ids.xlsx'));
      t.w.CRONOX_QR_EVENTS.leave();
      expect(request[1].signal.aborted).toBe(true);
      pending.resolve(file.response); await flush();
      expect(file.clicks).toHaveLength(0);
      expect(t.w.URL.createObjectURL).not.toHaveBeenCalled();
    } finally { t.close(); }
  });
});
