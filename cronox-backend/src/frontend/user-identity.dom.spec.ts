import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('shared public user identity presentation', () => {
  it('preserves issued codes verbatim and never identifies a person by rank or primary key', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(read('assets/user-identity.js'));
    const format = (dom.window as any).CRONOX_USER_IDENTITY.format;
    expect(format({ id: 999, registrationNumber: 1, memberCode: 'CRX-000050' })).toBe('CRX-000050');
    expect(format({ id: 7, memberCode: '000007' })).toBe('000007');
    expect(format({ id: 7, registrationNumber: 3 })).toBe('—');
    expect(format({ id: 1, memberCode: 'CRX-000001' })).not.toBe(format({ id: 2, memberCode: 'CRX-000002' }));
    dom.window.close();
  });

  it('loads the same formatter before the list, details and accreditation scripts', () => {
    for (const [html, script] of [['admin.html', 'assets/admin.js'], ['admin-user.html', 'assets/admin-user.js'], ['profile.html', 'assets/profile.js']]) {
      const page = read(html);
      expect(page.indexOf('assets/user-identity.js?v=1')).toBeGreaterThan(0);
      expect(page.indexOf('assets/user-identity.js?v=1')).toBeLessThan(page.indexOf(script));
    }
    expect(read('admin.html')).toContain('<th>N.º</th>');
    expect(read('admin.html')).toContain('<th>ID de usuario</th>');
    expect(read('src/admin/admin-user.ts')).toContain("{ label: 'ID interno', value: user.id }");
    expect(read('assets/profile.js')).toContain('window.CRONOX_USER_IDENTITY.format(user)');
  });
});
