const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
 testDir: './tests/mobile-compat', timeout: 90000, expect: { timeout: 10000 },
 workers: 3, fullyParallel: true, outputDir: 'output/playwright/mobile-compat/test-results',
 reporter: [['list'], ['json', { outputFile: 'output/playwright/mobile-compat/regression-results.json' }]],
 use: { baseURL: 'http://127.0.0.1:4185', viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
 projects: [
  { name: 'chromium', use: { browserName: 'chromium', isMobile: true } },
  { name: 'webkit', use: { browserName: 'webkit', isMobile: true } },
  // Firefox Playwright has no isMobile support: resize/touch coverage only.
  { name: 'firefox', use: { browserName: 'firefox' } },
 ],
 webServer: { command: 'node tests/mobile-compat/server.cjs', url: 'http://127.0.0.1:4185', reuseExistingServer: !process.env.CI },
});
