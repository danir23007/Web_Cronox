const { defineConfig } = require('@playwright/test');
const live = process.env.LIVE_SEO_AUDIT === 'true';
module.exports = defineConfig({
  testDir: './tests/seo', testMatch: live ? 'indexability-live.spec.cjs' : 'indexability-local.spec.cjs',
  timeout: 60000, workers: 1, reporter: 'list',
  outputDir: live ? 'test-results/indexability/live-browser' : 'test-results/indexability/local-browser',
  use: { browserName: 'chromium', baseURL: live ? 'https://cronox.es' : 'http://localhost:4197', viewport: { width: 1366, height: 900 } },
  ...(live ? {} : { webServer: { command: 'node tests/seo/local-server.cjs', url: 'http://localhost:4197/envios', timeout: 120000, reuseExistingServer: false } }),
});
