'use strict';
// Explicit read-only provider check. Does not import AppModule, Prisma or SMTP.
const fs = require('node:fs');
const path = require('node:path');
const backend = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const privateFile = value('--env');
const tracking = value('--tracking');
(async () => {
  if (!privateFile || !tracking || !/^[a-z0-9]{5,80}$/i.test(tracking)) throw Error('USAGE: node scripts/verify-correos-trackpub.cjs --env PRIVATE_FILE --tracking TRACKING_NUMBER');
  const input = require('dotenv').parse(fs.readFileSync(path.resolve(privateFile)));
  const keys = ['CORREOS_IDENTITY_CLIENT_ID', 'CORREOS_IDENTITY_CLIENT_SECRET', 'CORREOS_DEVELOPERS_CLIENT_ID', 'CORREOS_DEVELOPERS_CLIENT_SECRET'];
  if (keys.some(key => !input[key] || /REPLACE_WITH|PLACEHOLDER/.test(input[key]))) throw Error('CORREOS_CREDENTIALS_NOT_CONFIGURED');
  for (const key of keys) process.env[key] = input[key];
  Object.assign(process.env, { CORREOS_TRACKING_ENABLED: 'true', CORREOS_EMAIL_ENABLED: 'false', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' });
  require('ts-node').register({ transpileOnly: true, project: path.join(backend, 'tsconfig.json') });
  const { TrackpubClient } = require('../src/shipping-tracking/trackpub.client');
  const { TrackpubContract } = require('../src/shipping-tracking/trackpub.contract');
  const payload = await new TrackpubClient().search(tracking.toUpperCase());
  const events = new TrackpubContract().parse(payload, tracking.toUpperCase());
  // No tokens, credentials, identifiers, dates, addresses or response bodies.
  console.log(JSON.stringify({ trackpubResponseReceived: true, documentedShapeParsed: true,
    events: events.length, classifiedEvents: events.filter(event => event.category).length,
    unknownEvents: events.filter(event => !event.category).length,
    missingOrInvalidLocalDates: events.filter(event => !event.eventSortKey).length,
    databaseWrites: false, smtpConnected: false, liveTrackingValidation: true }, null, 2));
})().catch(error => {
  const code = typeof error.code === 'string' && /^(?:IDENTITY|TRACKPUB|TRACKING|INVALID|TOKEN|NETWORK|DEVELOPERS|RESPONSE|AUTH|CORREOS|USAGE)[A-Z0-9_: .-]*$/.test(error.code)
    ? error.code : /^(?:USAGE:|CORREOS_CREDENTIALS_NOT_CONFIGURED)/.test(error.message) ? error.message : 'CORREOS_CHECK_FAILED';
  console.error(code); process.exitCode = 1;
});
