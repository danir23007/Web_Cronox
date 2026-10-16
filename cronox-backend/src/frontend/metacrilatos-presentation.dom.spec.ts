import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const frontend = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(frontend, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('shared personal and sample METACRILATOS presentation', () => {
  const windows: any[] = [];
  afterEach(() => windows.splice(0).forEach(win => win.close()));
  function setup(preview = false) {
    const win = new JSDOM(read(preview ? 'metacrilatos-preview.html' : 'profile.html'), {
      url: preview ? 'http://localhost/api/admin/accreditations/metacrilatos/preview?previewRequest=test'
        : 'http://localhost/profile.html',
      runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
    }).window as any;
    windows.push(win);
    win.eval(read('assets/metacrilatos-presentation.js'));
    const section = win.document.querySelector('[data-profile-section="accreditation"]');
    return { win, section, member: section.querySelector('[data-metacrilatos-member]'), api: win.CRONOX_METACRILATOS_PRESENTATION };
  }

  it('builds the same single information template in the profile and minimal preview document', () => {
    const personal = setup();
    const preview = setup(true);
    expect(personal.member.innerHTML).toBe(preview.member.innerHTML);
    expect(preview.win.document.querySelector('.topbar, .profile-tabs, #passwordForm')).toBeNull();
    expect(preview.win.document.querySelector('script[src^="assets/profile.js"]')).toBeNull();
    expect(preview.win.document.querySelector('body > .footer').textContent).toBe('© CRONOX');
    expect(preview.win.document.querySelectorAll('[data-profile-back="store"]')).toHaveLength(1);
    const node = personal.member;
    personal.api.ensure(personal.section);
    expect(personal.section.querySelectorAll('[data-metacrilatos-member]')).toHaveLength(1);
    expect(personal.member).toBe(node);
  });

  it.each([1, 2, 3, 4, 5])('uses the same configured privileges and current indicator for circle %i', level => {
    const personal = setup();
    const preview = setup(true);
    for (const context of [personal, preview]) {
      context.api.circle(context.member, level);
      context.api.history(context.member, 'ready', { orders: 3, items: 5, products: 4 });
    }
    expect(personal.member.innerHTML).toBe(preview.member.innerHTML);
    expect(preview.member.querySelector('[aria-current="true"]').dataset.metaCircleMarker).toBe(String(level));
    expect(preview.member.querySelectorAll('[data-meta-privileges] li')).toHaveLength([1, 2, 3, 6, 7][level - 1]);
    expect(preview.member.querySelectorAll('[data-meta-circle-marker] button, [data-meta-circle-marker] a')).toHaveLength(0);
  });

  it('updates information without replacing the renderer, and keeps retry/error states distinct from zero', () => {
    const { win, section, member, api } = setup();
    const host = win.document.createElement('div');
    host.className = 'metacrilatos-host';
    host.style.transform = 'rotateY(73deg)';
    section.querySelector('.profile-card').prepend(host);
    api.circle(member, 5);
    api.history(member, 'error');
    expect(member.querySelector('[data-meta-stat]').textContent).toBe('—');
    expect(member.querySelector('[data-meta-retry]').hidden).toBe(false);
    api.history(member, 'ready', { orders: 0, items: 0, products: 0 });
    expect(member.querySelector('[data-meta-stat]').textContent).toBe('0');
    expect(member.querySelector('[data-meta-retry]').hidden).toBe(true);
    expect(section.querySelector('.metacrilatos-host')).toBe(host);
    expect(host.style.transform).toBe('rotateY(73deg)');
  });

  it('preview fetches sample data only; circle/width controls never save or activate and pagehide disposes the scene', async () => {
    const { win, section, member } = setup(true);
    const design = { renderer: 'metacrilatos-v1', sampleQr: 'data:image/png;base64,INVALID_PREVIEW' };
    win.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => design });
    const apply = jest.fn().mockResolvedValue(undefined);
    const destroy = jest.fn();
    win.CRONOX_ACCREDITATION_DESIGNS = { apply, destroy };
    await win.eval(read('assets/accreditation-preview.js'));
    expect(win.fetch.mock.calls).toEqual([['/api/admin/accreditations/metacrilatos/preview-data', { credentials: 'include', cache: 'no-store' }]]);
    const select = win.document.querySelector('[data-preview-circle]');
    for (const circle of [2, 3, 4, 5, 1]) {
      select.value = String(circle);
      select.dispatchEvent(new win.Event('change'));
      await tick();
      const sample = apply.mock.calls.at(-1)![2];
      expect(sample.circleLevel).toBe(circle);
      expect(sample.name).toBe('Andrea Ejemplo');
      expect(sample.visibleId).toBe('00000000-0000-4000-8000-000000000000');
      expect(sample.qrDataUrl).toBe(design.sampleQr);
      expect(member.dataset.circleLevel).toBe(String(circle));
      expect(member.querySelector('[data-meta-history]').dataset.state).toBe('ready');
    }
    const count = apply.mock.calls.length;
    win.dispatchEvent(new win.Event('resize'));
    await tick();
    expect(apply).toHaveBeenCalledTimes(count);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new win.Event('pagehide'));
    expect(destroy).toHaveBeenCalledWith(section);
    select.dispatchEvent(new win.Event('change'));
    await tick();
    expect(apply).toHaveBeenCalledTimes(count);
  });
});
