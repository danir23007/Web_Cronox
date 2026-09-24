const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual-flash',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: { command: 'node tests/cart/server.cjs', env: { CRONOX_TEST_CACHE_ASSETS: '1' }, url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
