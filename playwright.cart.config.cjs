const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/cart',
  timeout: 30000,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
