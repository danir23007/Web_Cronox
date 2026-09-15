import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('dedicated Admin authentication flow', () => {
  const adminHtml = readFrontend('admin.html');
  const adminUserHtml = readFrontend('admin-user.html');
  const adminScript = readFrontend('assets/admin.js');
  const adminUserScript = readFrontend('assets/admin-user.js');
  const loginHtml = readFrontend('admin-login.html');
  const loginScript = readFrontend('assets/admin-login.js');
  const routingScript = readFrontend('assets/admin-auth-routing.js');
  const mainSource = readFileSync(
    path.resolve(__dirname, '../main.ts'),
    'utf8',
  );
  const publicHtmlGateSource = readFileSync(
    path.resolve(__dirname, '../common/routing/public-html-gate.middleware.ts'),
    'utf8',
  );

  it('serves a dedicated, password-based Admin login without storefront content', () => {
    const document = new JSDOM(loginHtml).window.document;

    expect(document.querySelector('#adminLoginForm')).not.toBeNull();
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(document.querySelector('#adminLoginSubmit')?.textContent).toContain(
      'INICIAR SESIÓN',
    );
    expect(loginHtml).not.toContain('product-card');
    expect(loginHtml).toContain('noindex, nofollow');
  });

  it('keeps protected Admin shells hidden until the existing session is authorized', () => {
    const adminDocument = new JSDOM(adminHtml).window.document;
    const userDocument = new JSDOM(adminUserHtml).window.document;

    expect(adminDocument.documentElement.dataset.adminAuthState).toBe(
      'checking',
    );
    expect(
      adminDocument.querySelector('#adminShell')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(userDocument.documentElement.dataset.adminAuthState).toBe(
      'checking',
    );
    expect(
      userDocument.querySelector('#adminUserPage')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(adminScript).toContain("dataset.adminAuthState = 'authorized'");
    expect(adminUserScript).toContain('adminAuthState="authorized"');
  });

  it('removes every Admin authentication and logout redirect through the public index', () => {
    expect(adminScript).not.toContain("window.location.href = 'index.html'");
    expect(adminScript).not.toContain('cronox_open_auth_on_load');
    expect(adminUserScript).not.toContain('index.html');
    expect(adminUserScript).not.toContain('cronox_open_auth_on_load');
    expect(adminScript).toContain('redirectToLogin();');
    expect(adminScript).toContain('await window.CRONOX_API?.logout?.()');
  });

  it('allows only same-origin Admin return URLs and normalizes /admin to /admin.html', () => {
    const dom = new JSDOM('', {
      runScripts: 'outside-only',
      url: 'https://cronox.test/admin-user.html?id=42#perfil',
    });
    dom.window.eval(routingScript);
    const auth = (
      dom.window as unknown as {
        CRONOX_ADMIN_AUTH: {
          safeReturnTo: (value: string) => string;
          currentReturnTo: () => string;
          isAdmin: (user: { role: string }) => boolean;
        };
      }
    ).CRONOX_ADMIN_AUTH;

    expect(auth.safeReturnTo('/admin')).toBe('/admin.html');
    expect(auth.safeReturnTo('/admin.html#pedidos')).toBe(
      '/admin.html#pedidos',
    );
    expect(auth.safeReturnTo('/admin-user.html?id=42')).toBe(
      '/admin-user.html?id=42',
    );
    expect(auth.safeReturnTo('https://attacker.test/admin.html')).toBe(
      '/admin.html',
    );
    expect(auth.safeReturnTo('/key-screen.html')).toBe('/admin.html');
    expect(auth.currentReturnTo()).toBe('/admin-user.html?id=42#perfil');
    expect(auth.isAdmin({ role: 'ADMIN' })).toBe(true);
    expect(auth.isAdmin({ role: 'SUPERADMIN' })).toBe(true);
    expect(auth.isAdmin({ role: 'SUPER_ADMIN' })).toBe(false);
    expect(auth.isAdmin({ role: 'LOGISTICS' })).toBe(false);
    expect(auth.isAdmin({ role: 'FRIEND' })).toBe(false);
    expect(auth.isAdmin({ role: 'USER' })).toBe(false);
  });

  it('rejects non-Admin credentials generically and clears the newly created user session', async () => {
    const dom = new JSDOM(loginHtml, {
      runScripts: 'outside-only',
      url: 'https://cronox.test/admin-login.html',
    });
    const login = jest.fn().mockResolvedValue({ role: 'USER' });
    const logout = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window, 'CRONOX_API', {
      value: { getMe: jest.fn().mockResolvedValue(null), login, logout },
    });
    dom.window.eval(routingScript);
    dom.window.eval(loginScript);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const document = dom.window.document;
    (document.querySelector('#adminLoginEmail') as HTMLInputElement).value =
      'person@example.test';
    (document.querySelector('#adminLoginPassword') as HTMLInputElement).value =
      'not-an-admin';
    document
      .querySelector('#adminLoginForm')
      ?.dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(login).toHaveBeenCalledWith({
      email: 'person@example.test',
      password: 'not-an-admin',
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#adminLoginStatus')?.textContent).toBe(
      'No se pudo iniciar sesión. Revisa tus credenciales.',
    );
  });

  it('keeps Admin pages outside Pantalla Clave and normalizes the extensionless route', () => {
    expect(publicHtmlGateSource).toContain("'/admin-login.html'");
    expect(mainSource).toContain("app.use(['/admin', '/admin/']");
    expect(mainSource).toContain("res.redirect(307, '/admin.html')");
    expect(publicHtmlGateSource).toMatch(
      /pathname\.startsWith\('\/api'\)[\s\S]*const keyScreenEnabled = await keyScreen\.shouldGatePublicHtml\(\)/,
    );
    expect(publicHtmlGateSource).toContain(
      "res.sendFile(join(frontendRoot, 'key-screen.html'))",
    );
  });
});
