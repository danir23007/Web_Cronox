// Local SMTP and PostgreSQL only; credentials and recipients below are synthetic.
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { SMTPServer } = require('smtp-server');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const local = loadLocalEnvironment();
ensureLocalPostgres(local);
Object.assign(process.env, local);
const destination = new URL(local.DATABASE_URL);
assert(['127.0.0.1', 'localhost'].includes(destination.hostname));
assert.equal(local.EMAIL_ENABLED, 'false');
assert.equal(local.BACKGROUND_JOBS_ENABLED, 'false');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const recipient = `mail-policy-${randomUUID()}@example.test`;
const messages = [], authentications = [];
let dropDataResponse = false;
const smtp = new SMTPServer({ secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
  onAuth(auth, session, callback) {
    authentications.push(auth.username);
    callback(null, { user: auth.username });
  },
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', data => { raw += data.toString(); });
    stream.on('end', () => {
      messages.push({ from: session.envelope.mailFrom.address, raw });
      if (dropDataResponse) {
        dropDataResponse = false;
        // The server received DATA but its final acceptance response is lost.
        for (const connection of smtp.connections) connection._socket.destroy();
        return;
      }
      callback();
    });
  },
});
async function main() {
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { EMAIL_ENABLED: 'true', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.server.address().port), SMTP_SECURE: 'false',
    SMTP_NOREPLY_USER: 'configured-noreply@example.test', SMTP_NOREPLY_PASS: 'synthetic-local-password',
    SMTP_INFO_USER: 'campaign-info@example.test', SMTP_INFO_PASS: 'synthetic-info-password',
    SMTP_ORDERS_USER: 'orders@example.test', SMTP_ORDERS_PASS: 'synthetic-orders-password',
    SMTP_SUPPORT_USER: 'support@example.test', SMTP_SUPPORT_PASS: 'synthetic-support-password',
    SMTP_NOREPLY_HOURLY_LIMIT: '100000', SMTP_NOREPLY_DAILY_LIMIT: '100000' });
  const { MailTransportFactory } = require('../dist/email/mail-transport.factory');
  const { EmailService } = require('../dist/email/email.service');
  const { EmailSenderKey } = require('../dist/email/email.types');
  const factory = new MailTransportFactory(db), email = new EmailService(factory);
  assert(email.isNewsletterSenderConfigured());
  assert(email.isRestockSenderConfigured());
  await email.sendNewsletterAccess(recipient, 'http://localhost/access#synthetic-token', true, 'bavolima');
  await email.sendNewsletterWelcome(recipient, 'ABC234');
  await email.sendRestock(recipient, { product: 'Camiseta local', size: 'M', actionUrl: 'http://localhost/product' });
  assert.equal(messages.length, 3);
  assert(messages.every(message => message.from === 'configured-noreply@example.test'));
  assert(authentications.every(user => user === 'configured-noreply@example.test'));
  assert(messages[0].raw.includes('bavolima'));
  assert(messages[1].raw.includes('ABC234'));
  const history = await db.emailDelivery.findMany({ where: { recipient } });
  assert.equal(history.length, 3);
  assert(history.every(row => row.senderKey === 'NOREPLY' && row.status === 'SMTP_ACCEPTED'));
  assert(!JSON.stringify(history).includes('bavolima'));
  assert(!JSON.stringify(history).includes('synthetic-token'));
  await factory.getTransport(EmailSenderKey.NOREPLY).verify();
  assert.equal(messages.length, 3, 'Connection verification sends no message');
  const hourly = await db.emailDelivery.count({ where: { senderKey: 'NOREPLY', createdAt: { gte: new Date(Date.now() - 3600000) } } });
  process.env.SMTP_NOREPLY_HOURLY_LIMIT = String(hourly);
  await assert.rejects(email.sendNewsletterWelcome(recipient, 'ABC234'));
  assert.equal(messages.length, 3, 'No-reply quota blocks before SMTP');
  process.env.SMTP_NOREPLY_HOURLY_LIMIT = String(hourly + 1);
  const concurrent = await Promise.allSettled([
    email.sendNewsletterAccess(recipient, 'http://localhost/access', false),
    email.sendNewsletterAccess(recipient, 'http://localhost/access', false),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(messages.length, 4, 'Concurrent workers reserve only one remaining No-reply slot');
  for (const sender of [EmailSenderKey.INFO, EmailSenderKey.ORDERS, EmailSenderKey.SUPPORT]) {
    await factory.sendMail(sender, { to: recipient, subject: 'Local regression', text: 'Synthetic local content' }, 'ADMIN_TEST');
    factory.getTransport(sender).close();
  }
  assert.deepEqual(messages.slice(-3).map(message => message.from), ['campaign-info@example.test', 'orders@example.test', 'support@example.test']);
  process.env.SMTP_NOREPLY_HOURLY_LIMIT = '100000';
  dropDataResponse = true;
  const uncertain = await email.sendNewsletterAccess(recipient, 'http://localhost/access#synthetic-lost-response', true, 'bavolima').catch(error => error);
  assert.equal(uncertain.deliveryUnknown, true, 'Lost DATA response must not allow password rollback/retry');
  const unknownHistory = await db.emailDelivery.findMany({ where: { recipient, status: 'UNKNOWN' } });
  assert.equal(unknownHistory.length, 1);
  assert(!JSON.stringify(unknownHistory).includes('bavolima'));
  assert(!JSON.stringify(unknownHistory).includes('synthetic-lost-response'));
  factory.getTransport(EmailSenderKey.NOREPLY).close();
  console.log(JSON.stringify({ localSMTP: true, realEnvelopeAndAuthentication: 'NOREPLY', purposes: ['NEWSLETTER_ACCESS','NEWSLETTER_WELCOME','RESTOCK'], noSecretInHistory: true, sharedQuotaVerified: true, lostDataResponseUncertain: true, verifySendsNoEmail: true, externalEmailSent: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  messages.length = 0;
  await db.emailDelivery.deleteMany({ where: { recipient } });
  await db.$disconnect();
  await new Promise(resolve => smtp.close(resolve));
});
