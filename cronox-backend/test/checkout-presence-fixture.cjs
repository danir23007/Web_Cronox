// Other DOM suites isolate recommendations/typography/startup from inventory.
// Dedicated presence/DB/browser suites exercise the actual HTTP transition.
const fs = require('node:fs');
const path = require('node:path');
exports.install = window => {
  window.eval(fs.readFileSync(path.resolve(__dirname, '../../cronox-front/assets/checkout-presence.js'), 'utf8'));
  const real = window.CRONOX_CHECKOUT_PRESENCE;
  window.CRONOX_CHECKOUT_PRESENCE = { create(options) {
    return real.create({ ...options, request: async endpoint => ({ checkoutSnapshotId: 'fixture-presence',
      serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 360000).toISOString(),
      reservationPhase: endpoint === 'payment-start' ? 'PROTECTED' : 'PRESENCE',
      paymentStartedAt: endpoint === 'payment-start' ? new Date().toISOString() : null,
    }) });
  } };
};
