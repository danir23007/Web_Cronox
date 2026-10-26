import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMeDto } from '../me/dto/update-me.dto';

const read = (name: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));

async function setup(firstName = 'Persona', failSession = false) {
  const dom = new JSDOM(read('profile.html'), { url: 'http://localhost/perfil', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  windows.push(dom);
  const win = dom.window as any;
  win.CRONOX_USER = { id: 7, identityUid: 'stable-identity', role: 'USER', circleLevel: 2, firstName, lastName: 'Prueba', memberCode: 'CRX-000007' };
  const updateMe = jest.fn(async (payload: object) => ({ ...win.CRONOX_USER, ...payload, role: 'FRIEND' }));
  win.CRONOX_COOKIE_CONSENT = { hasConsent: () => true };
  win.CRONOX_USER_IDENTITY = {format: () => 'CRX-000007'};
  win.fetch = async (url: string) => ({ok: true, json: async () => url.endsWith('/active')
    ? {id: 'original', renderer: 'original-v1', config: {version: 1, artworkUrl: '/assets/logo_banner.png'}}
    : {circleLevel: 2, name: 'Persona Prueba', visibleId: 'CRX-000007', createdAt: '2020-01-01', qrDataUrl: 'data:image/png;base64,AA=='}});
  win.eval(read('assets/accreditation-designs.js'));
  for (const image of win.document.querySelectorAll('img')) {
    Object.defineProperty(image, 'complete', {get: () => true});
    Object.defineProperty(image, 'naturalWidth', {get: () => 512});
  }
  win.CRONOX_API = { updateMe, requestCirclePromotion: async () => ({status: 'pending'}),
    getAccreditationStats: async () => ({circleLevel: 2, promotion: {canRequest: true, hasPending: false, fromCircle: 2, toCircle: 3, eligibleAt: '2020-01-01', serverTime: new Date().toISOString()}}),
    getCircleUpgradeStatus: async () => ({circleLevel: 2, canRequest: false}) };
  if (failSession) win.CRONOX_API.getMe = jest.fn().mockRejectedValue(new Error('temporary outage'));
  win.eval(read('assets/profile.js'));
  await tick();
  const submit = async (name: string) => {
    win.document.getElementById('firstName').value = name;
    win.document.getElementById('accountForm').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
  };
  return {win, updateMe, submit};
}

it.each(['María José', 'Ángel', 'Jean-Luc', "O'Neil", 'Nombre9'])('matches the existing backend name policy for %s', async name => {
  const {win, updateMe, submit} = await setup();
  const errors = await validate(plainToInstance(UpdateMeDto, {firstName: name}));
  await submit(name);
  expect(updateMe.mock.calls.length).toBe(errors.length ? 0 : 1);
  if (errors.length) expect(win.document.getElementById('profileMessage').textContent).toContain('letras y espacios');
});

it('reloads the profile and removes only its stale load error after session recovery', async () => {
  const { win } = await setup('Persona', true);
  expect(win.document.getElementById('profileMessage').hidden).toBe(false);
  win.CRONOX_API.getMe.mockResolvedValue(win.CRONOX_USER);
  win.dispatchEvent(new win.CustomEvent('cronox:authResolved', { detail: { state: 'authenticated' } }));
  await tick();
  expect(win.document.getElementById('firstName').value).toBe('Persona');
  expect(win.document.getElementById('profileMessage').hidden).toBe(true);
});

it('omits an unchanged legacy name and retains identity, authoritative role and promotion modal persistence after saving', async () => {
  const {win, updateMe, submit} = await setup('Nombre-Legado');
  await submit('Nombre-Legado');
  expect(updateMe).toHaveBeenCalledWith({});
  expect(win.CRONOX_USER.identityUid).toBe('stable-identity');
  expect(win.CRONOX_USER.role).toBe('FRIEND');
  win.document.querySelector('[data-profile-tab="accreditation"]').click();
  await tick(); await tick();
  const button = win.document.querySelector('[data-circle-request-btn]');
  expect(button.disabled).toBe(false);
  button.click(); await tick();
  expect(win.document.getElementById('circleRequestModal').hidden).toBe(false);
  expect(win.localStorage.getItem('cronox_circle_request_modal_seen_stable-identity')).toBe('1');
});
