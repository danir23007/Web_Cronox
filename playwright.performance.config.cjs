const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/performance', testMatch: '*.spec.cjs', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 412, height: 823 }, deviceScaleFactor: 2, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
