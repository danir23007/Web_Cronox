const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/seo', testMatch: '*.spec.cjs', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4177' },
  projects: ['chromium', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: { command: 'node tests/seo/server.cjs', url: 'http://127.0.0.1:4177', reuseExistingServer: false },
});
