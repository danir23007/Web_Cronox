import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const html = readFileSync(join(__dirname, '../../../cronox-front/reset-password.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
function screen(url: string, response: { ok: boolean; json: () => Promise<unknown> }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const fetch = jest.fn().mockResolvedValue(response);
  Object.assign(dom.window, { fetch, TextEncoder, CRONOX_API: { API_BASE: '', getCsrfHeaders: async () => ({ 'x-csrf-token': 'local-csrf' }) } });
  dom.window.setTimeout = jest.fn();
  const form = dom.window.document.getElementById('resetForm') as HTMLFormElement;
  for (const name of ['password', 'passwordConfirm']) Object.defineProperty(form, name, { value: form.querySelector(`[name="${name}"]`) });
  dom.window.eval(script!);
  const submit = async () => {
    for (const input of form.querySelectorAll<HTMLInputElement>('input')) input.value = 'LocalOnlyPassword';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
  };
  return { dom, fetch, submit, form };
}
it('preserves a query reset token through reload in a fragment and removes it after confirmed success', async () => {
  const success = { ok: true, json: async () => ({ ok: true }) };
  const first = screen('http://localhost/restablecer-contrasena?token=local-test-token', success);
  expect(new URL(first.dom.window.location.href).searchParams.has('token')).toBe(false);
  const reloaded = screen(first.dom.window.location.href, success);
  expect(reloaded.form.querySelector('button')!.disabled).toBe(false);
  await reloaded.submit();
  expect(JSON.parse(reloaded.fetch.mock.calls[0][1].body).token).toBe('local-test-token');
  expect(reloaded.dom.window.location.hash).toBe('');
  expect(reloaded.dom.window.document.getElementById('resetMessage')!.textContent).toContain('correctamente');
  first.dom.window.close(); reloaded.dom.window.close();
});
it.each(['El enlace ha caducado. Solicita uno nuevo.', 'Este enlace ya se ha utilizado. Solicita uno nuevo.'])('keeps the draft and enables retry after backend rejection: %s', async message => {
  const view = screen('http://localhost/restablecer-contrasena#token=local-test-token', { ok: false, json: async () => ({ message }) });
  await view.submit();
  expect(view.form.querySelector('button')!.disabled).toBe(false);
  expect(view.dom.window.document.getElementById('resetMessage')!.textContent).toBe(message);
  expect(view.form.querySelector<HTMLInputElement>('input')!.value).toBe('LocalOnlyPassword');
  expect(view.dom.window.location.hash).toContain('token=');
  view.dom.window.close();
});
