const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/favorites-badge', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: ['chromium', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
});
