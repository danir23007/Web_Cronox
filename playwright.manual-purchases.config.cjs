const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/manual-purchases', workers: 1,
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4173' },
  webServer: { command: 'node tests/cart/server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
