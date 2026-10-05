'use strict';
// No credentials, providers or database. Exercise the actually resolved parsers/codecs.
const assert = require('node:assert/strict');
async function main() {
  const { recipientUnits } = require('../dist/email/mail-account-quota');
  assert.deepEqual(recipientUnits({ to: '"Ana, User" <ana@example.test>, Team: b@example.test, c@example.test;', cc: 'ANA@example.test', bcc: { name: 'D', address: 'd@example.test' } }),
    { units: 4, recipients: ['ana@example.test', 'b@example.test', 'c@example.test', 'd@example.test'] });
  assert.throws(() => recipientUnits({ to: Array.from({ length: 101 }, (_, i) => `${i}@example.test`) }), /EMAIL_RECIPIENT_LIMIT/);
  assert.throws(() => recipientUnits({}), /EMAIL_RECIPIENT_LIMIT/);
  const composer = require('nodemailer/lib/mail-composer');
  const message = await new composer({ from: 'no-reply@example.test', to: 'ana@example.test', subject: 'Local attachment review',
    text: 'Synthetic only', disableFileAccess: true, disableUrlAccess: true,
    attachments: [{ filename: 'test.txt', content: Buffer.from('inline test') }] }).compile().build();
  const parsed = await require('mailparser').simpleParser(message);
  assert.equal(parsed.attachments.length, 1); assert.equal(parsed.attachments[0].content.toString(), 'inline test');
  for (const path of ['C:/Windows/win.ini', 'https://external.example.invalid/file']) {
    await assert.rejects(new composer({ to: 'ana@example.test', disableFileAccess: true, disableUrlAccess: true,
      attachments: [{ path }] }).compile().build(), /access rejected/i);
  }
  const qs = require('qs');
  assert.deepEqual(qs.parse('filters[category]=camisetas&filters[size]=M'), { filters: { category: 'camisetas', size: 'M' } });
  qs.parse('__proto__[cronoxInjected]=true&constructor[prototype][cronoxInjected]=true', { allowPrototypes: true });
  assert.equal({}.cronoxInjected, undefined);
  const sharp = require('sharp');
  for (const format of ['jpeg', 'png', 'webp']) {
    const buffer = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#123456' } }).toFormat(format).toBuffer();
    const result = await sharp(buffer, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 40 }).webp().toBuffer();
    const info = await sharp(result).metadata(); assert.equal(info.width, 40); assert.equal(info.height, 32); assert.equal(info.format, 'webp');
  }
  await assert.rejects(sharp(Buffer.from('invalid image')).metadata());
  console.log(JSON.stringify({ recipientParser: require('nodemailer/package.json').version, mailboxAlias: require('mailbox-nodemailer/package.json').version,
    qs: require('qs/package.json').version, sharp: sharp.versions.sharp, libvips: sharp.versions.vips,
    checks: 'recipient groups/dedup/limits; inline MIME attachment; file and URL access rejected; form parser; JPEG/PNG/WebP transforms and invalid input' }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
