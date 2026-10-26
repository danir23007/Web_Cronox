import { simpleParser } from 'mailparser';

// Offline regressions: parsing must not turn display/comment text into a
// recipient, including the aliased transport and inbound mailbox dependency.
const parsers = [
  ['notifications', require('nodemailer/lib/addressparser')],
  ['mailbox', require('mailbox-nodemailer/lib/addressparser')],
] as const;
const cases = [
  ['nested comment', 'Victim (x(y) <evil@example.test>) <v@recipient.test>', 'v@recipient.test'],
  ['group comment', 'G: (a; <evil@example.test>) <v@recipient.test>;', 'v@recipient.test'],
  ['group quoted name', 'G: "a;" "<evil@example.test>" <v@recipient.test>;', 'v@recipient.test'],
  ['quoted local part', '<"a@evil.test>"@recipient.test>', '"a@evil.test>"@recipient.test'],
] as const;
describe.each(parsers)('%s address parser security', (_name, parse) => {
  it.each(cases)('preserves the actual recipient: %s', (_label, input, expected) => {
    expect(parse(input, { flatten: true }).map((item: { address: string }) => item.address)).toEqual([expected]);
  });
});
describe('inbound mailbox address parser security', () => {
  it.each(cases)('preserves the author: %s', async (_label, input, expected) => {
    const mail = await simpleParser(`From: ${input}\r\nTo: local@example.test\r\nSubject: Offline fixture\r\n\r\nBody`);
    const addresses = mail.from?.value.flatMap(item =>
      'group' in item ? (item.group as { address: string }[]).map(member => member.address) : [item.address],
    );
    expect(addresses).toEqual([expected]);
  });
});
