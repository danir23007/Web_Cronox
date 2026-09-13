import { readFileSync } from 'fs';
import { join } from 'path';

describe('Admin storefront preview navigation', () => {
  const adminSource = readFileSync(
    join(__dirname, '..', '..', '..', 'cronox-front', 'assets', 'admin.js'),
    'utf8',
  );

  it('returns to the real public root from the Back button', () => {
    expect(adminSource).toContain(
      "backBtn?.addEventListener('click', redirectToHome)",
    );
  });

  it('redirects to the public root after the existing logout request finishes', () => {
    const logoutStart = adminSource.indexOf(
      "logoutBtn?.addEventListener('click'",
    );
    const backButtonStart = adminSource.indexOf(
      "backBtn?.addEventListener('click'",
      logoutStart,
    );
    const logoutHandler = adminSource.slice(logoutStart, backButtonStart);

    expect(logoutHandler).toContain('window.CRONOX_API?.logout?.()');
    expect(logoutHandler).toContain('redirectToHome()');
    expect(logoutHandler).not.toContain('redirectToLogin()');
  });
});
