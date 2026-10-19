import { execFileSync } from 'node:child_process';
import path from 'node:path';

const { unapprovedImageChanges } = require('../../scripts/verify-ui-media-optimization.cjs') as {
  unapprovedImageChanges(status: string): string[];
};

describe('static UI media optimization', () => {
  it('ignores reinstalled dependency logos while rejecting unapproved project images', () => {
    expect(unapprovedImageChanges([
      ' D node_modules/passport/sponsors/fusionauth.png',
      ' M cronox-backend/node_modules/swagger-ui-dist/favicon-16x16.png',
      ' M cronox-front/assets/logo-topbar.webp',
      '?? cronox-front/assets/metacrilatos/wordmark.png',
      ' M cronox-front/assets/product-photo.jpg',
      '?? docs/unreviewed-banner.svg',
      '?? cronox-front/assets/metacrilatos/unapproved.png',
      '?? cronox-front/assets/mail/welcome/logo-cronox.png',
      '?? cronox-front/assets/mail/welcome/unapproved.png',
    ].join('\n'))).toEqual([
      'cronox-front/assets/product-photo.jpg', 'docs/unreviewed-banner.svg',
      'cronox-front/assets/metacrilatos/unapproved.png',
      'cronox-front/assets/mail/welcome/unapproved.png',
    ]);
  });
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
