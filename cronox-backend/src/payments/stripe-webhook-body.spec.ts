import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Stripe signed raw-body pipeline', () => {
  it('preserves signed bytes through raw and JSON parsing, rejecting a different endpoint secret', async () => {
    // Match the production bootstrap order; no external Stripe calls.
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(main).toContain('{ bodyParser: false }');
    expect(main.indexOf("app.use('/api/webhooks/stripe', express.raw")).toBeLessThan(main.indexOf("app.use(express.json"));
    const stripe = new Stripe('sk_test_dummy');
    const payload = '{\n  "id": "evt_signed", "type": "payment_intent.succeeded", "livemode": true\n}';
    const secret = 'whsec_test_endpoint';
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const app = express();
    app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
    app.use(express.json({ limit: '100kb' }));
    let configuredSecret = secret;
    app.post('/api/webhooks/stripe', (req, res) => {
      expect(Buffer.isBuffer(req.body)).toBe(true);
      expect(req.body.toString()).toBe(payload);
      try {
        stripe.webhooks.constructEvent(req.body, req.get('stripe-signature')!, configuredSecret);
        res.status(200).json({ verified: true });
      } catch {
        res.status(400).json({ code: 'STRIPE_SIGNATURE_VERIFICATION_FAILED' });
      }
    });
    await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
    configuredSecret = 'whsec_other_endpoint';
    await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(400, { code: 'STRIPE_SIGNATURE_VERIFICATION_FAILED' });
  });
});
