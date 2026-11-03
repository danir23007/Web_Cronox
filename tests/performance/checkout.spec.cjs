const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
test('shared images retain the simulated guest and account checkout flows', async ({ page }) => {
  test.setTimeout(90000);
  // Existing review scenario: all API and Stripe boundaries are intercepted.
  const source = fs.readFileSync(path.resolve(__dirname, '../stock-reservations/checkout-browser.cli.js'), 'utf8');
  const scenario = (0, eval)(`(${source})`);
  await scenario(page);
});
