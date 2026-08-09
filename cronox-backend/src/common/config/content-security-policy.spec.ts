import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createContentSecurityPolicy,
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
});
