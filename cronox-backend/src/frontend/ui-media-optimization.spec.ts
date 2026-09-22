import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('static UI media optimization', () => {
  it('passes the explicit media allowlist and runtime verification', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    expect(() =>
      execFileSync(
        process.execPath,
        ['cronox-backend/scripts/verify-ui-media-optimization.cjs'],
        { cwd: repositoryRoot, stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
});
