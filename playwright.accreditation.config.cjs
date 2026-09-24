const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/accreditation-mobile',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'chromium-320', use: { browserName: 'chromium', viewport: { width: 320, height: 568 } } },
    { name: 'webkit-iphone-13', use: { browserName: 'webkit', ...devices['iPhone 13'] } },
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node tests/cart/server.cjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
