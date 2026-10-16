import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createContentSecurityPolicy,
  documentSecurityHeaders,
  getInlineScriptHashes,
  normalizeInlineScriptForCsp,
} from './content-security-policy';

describe('content security policy helpers', () => {
  let frontendRoot: string;

  beforeEach(() => {
    frontendRoot = mkdtempSync(join(tmpdir(), 'cronox-csp-'));
  });

  afterEach(() => {
    rmSync(frontendRoot, { recursive: true, force: true });
  });

  it('hashes CRLF inline scripts as browsers tokenize them', () => {
    const sourceWithCrlf = "\r\n  window.CRONOX = 'ready';\r\n";
    writeFileSync(
      join(frontendRoot, 'index.html'),
      `<html><body><script>${sourceWithCrlf}</script></body></html>`,
      'utf8',
    );

    const browserSource = "\n  window.CRONOX = 'ready';\n";
    const expectedHash = createHash('sha256')
      .update(browserSource)
      .digest('base64');

    expect(normalizeInlineScriptForCsp(sourceWithCrlf)).toBe(browserSource);
    expect(getInlineScriptHashes(frontendRoot)).toEqual([
      `'sha256-${expectedHash}'`,
    ]);
  });

  it('keeps unsafe-inline out of the script policy', () => {
    writeFileSync(
      join(frontendRoot, 'index.html'),
      '<script>window.CRONOX = true;</script>',
      'utf8',
    );

    const policy = createContentSecurityPolicy(frontendRoot);
    const scriptSource = policy
      .split('; ')
      .find((directive) => directive.startsWith('script-src'));

    expect(scriptSource).toBeDefined();
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(scriptSource).toContain("'sha256-");
  });

  it('allows same-origin camera and WebAssembly only on the administrator document', () => {
    const base = createContentSecurityPolicy(frontendRoot);
    for (const path of ['/admin.html', '/admin.html?qr-event=example']) {
      const policy = documentSecurityHeaders(base, path);
      expect(policy.permissionsPolicy).toBe(
        'camera=(self), geolocation=(), microphone=()',
      );
      expect(policy.contentSecurityPolicy).toContain(
        "script-src 'self' 'wasm-unsafe-eval'",
      );
      expect(policy.contentSecurityPolicy).not.toContain("'unsafe-eval'");
      expect(policy.contentSecurityPolicy).toContain("frame-ancestors 'none'");
    }
    for (const path of [
      '/',
      '/profile.html',
      '/admin-login.html',
      '/api/admin/qr-events',
      '/api/admin/accreditations/metacrilatos/preview',
      '/admin.html/other',
      '/assets/qr-reader.js',
    ]) {
      const policy = documentSecurityHeaders(base, path);
      expect(policy.permissionsPolicy).toBe(
        'camera=(), geolocation=(), microphone=()',
      );
      expect(policy.contentSecurityPolicy).toBe(base);
    }
  });
});
