const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['cart/cart.spec.cjs', 'favorites-badge/badge.spec.cjs', 'newsletter/subscribe.spec.cjs', 'visual-flash/card-hover.spec.cjs'],
  timeout: 45000, workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
