const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/visual-flash', testMatch: 'card-hover.spec.cjs', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
});
