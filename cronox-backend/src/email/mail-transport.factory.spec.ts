import { MailTransportFactory } from './mail-transport.factory';
import { EmailSenderKey } from './email.types';
import * as security from '../mailbox/mailbox-security';
import { simpleParser } from 'mailparser';

describe('durable email delivery history', () => {
  const originalUser = process.env.SMTP_INFO_USER;
  beforeAll(() => { process.env.SMTP_INFO_USER = 'info@example.test'; });
  afterAll(() => { if (originalUser === undefined) delete process.env.SMTP_INFO_USER; else process.env.SMTP_INFO_USER = originalUser; });
  const setup = () => {
    const db: any = { emailDelivery: { create: jest.fn().mockResolvedValue({ id: 'attempt' }), update: jest.fn() } };
    db.$transaction = jest.fn(async fn => fn({ ...db,
      $executeRaw: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([{ now: new Date() }]),
      mailAccountQuota: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    }));
    const factory = new MailTransportFactory(db);
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id', accepted: ['test@example.test'] });
    jest.spyOn(factory, 'getTransport').mockReturnValue({ sendMail } as any);
    jest.spyOn(factory, 'getFrom').mockReturnValue('info@example.test');
    return { db, factory, sendMail };
  };
  it('records before sending, then SMTP acceptance; never stores body or private links', async () => {
    const { db, factory, sendMail } = setup();
    await factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test', subject: 'Bienvenida', html: 'private-token-and-code' }, 'NEWSLETTER_WELCOME');
    expect(db.emailDelivery.create.mock.invocationCallOrder[0]).toBeLessThan(sendMail.mock.invocationCallOrder[0]);
    expect(JSON.stringify(db.emailDelivery.create.mock.calls)).not.toContain('private-token-and-code');
    expect(db.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      status: 'SMTP_ACCEPTED', providerMessageId: 'id', pendingPayload: null, readyAt: null,
    } }));
  });
  it('sends nothing if recording the attempt fails', async () => {
    const { db, factory, sendMail } = setup(); db.emailDelivery.create.mockRejectedValue(new Error('db'));
    await expect(factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test' })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('keeps independent MIME IDs, no reply headers, and reports the actual precompiled Message-ID', async () => {
    const { factory, sendMail, db } = setup();
    const ids: string[] = [];
    sendMail.mockImplementation(async options => {
      const message = await simpleParser(options.raw, { skipHtmlToText: true, skipTextToHtml: true });
      expect(message.messageId).toBe(options.messageId);
      expect(message.headers.has('in-reply-to')).toBe(false);
      expect(message.headers.has('references')).toBe(false);
      expect(message.html).toBe('<p>Independent welcome</p>');
      ids.push(message.messageId!);
      return { messageId: message.messageId, accepted: ['test@example.test'] };
    });
    for (let i = 0; i < 2; i++) await factory.sendMail(EmailSenderKey.INFO, {
      to: 'test@example.test', subject: 'Independent test', html: '<p>Independent welcome</p>', text: 'Independent welcome',
    }, 'ADMIN_TEST');
    expect(new Set(ids).size).toBe(2);
    expect(db.emailDelivery.update.mock.calls.map(call => call[0].data.providerMessageId)).toEqual(ids);
  });
  it.each([['EAUTH', 'FAILED'], ['ETIMEDOUT', 'UNKNOWN']])('records %s without exposing raw server errors', async (code, status) => {
    const { db, factory, sendMail } = setup(); sendMail.mockRejectedValue(Object.assign(new Error('secret SMTP data'), { code }));
    await expect(factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test' })).rejects.toThrow();
    expect(db.emailDelivery.update.mock.calls[0][0].data.status).toBe(status);
    expect(JSON.stringify(db.emailDelivery.update.mock.calls)).not.toContain('secret SMTP data');
  });
  it.each([
    // Nodemailer also reports CONN on a socket close after transmitting DATA.
    [{ code: 'ECONNECTION', command: 'CONN' }, 'UNKNOWN'],
    [{ code: 'ECONNECTION', command: 'CONN', responseCode: 421 }, 'UNKNOWN'],
    [{ code: 'ECONNECTION', command: 'DATA' }, 'UNKNOWN'],
    [{ code: 'ECONNECTION', command: 'QUIT', responseCode: 421 }, 'UNKNOWN'],
    [{ code: 'ECONNECTION' }, 'UNKNOWN'],
    [{ code: 'EAUTH', accepted: ['test@example.test'] }, 'UNKNOWN'],
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }, 'FAILED'],
  ])('uses SMTP phase and acceptance for %j, preserving uncertain passwords', async (details, status) => {
    const { db, factory, sendMail } = setup();
    sendMail.mockRejectedValue(Object.assign(new Error('private server response'), details));
    const failure = await factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test' }).catch(error => error);
    expect(db.emailDelivery.update.mock.calls[0][0].data.status).toBe(status);
    expect(failure.deliveryUnknown === true).toBe(status === 'UNKNOWN');
    expect(JSON.stringify(db.emailDelivery.update.mock.calls)).not.toContain('private server response');
  });
});

describe('deferred mail requiring operator review', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    ['unknown sender', { senderKey: 'INVALID' }, undefined, 'EMAIL_DEFERRED_INVALID_JOB'],
    ['missing payload', { pendingPayload: null }, undefined, 'EMAIL_DEFERRED_INVALID_JOB'],
    ['unavailable key', {}, new Error('private key detail'), 'EMAIL_DEFERRED_KEY_UNAVAILABLE'],
    ['invalid recipients', {}, { raw: 'YQ==', envelope: { from: 'current@example.test', to: [] } }, 'EMAIL_DEFERRED_LIMIT_REVIEW'],
    ['changed account', {}, { raw: 'YQ==', envelope: { from: 'old@example.test', to: ['recipient@example.test'] } }, 'EMAIL_ACCOUNT_CHANGED_REVIEW'],
  ])('moves %s outside the due batch, retaining encrypted evidence and version guard', async (_name, extra, decoded, errorCode) => {
    const job = { id: 'job', senderKey: 'INFO', pendingPayload: 'encrypted', quotaUnits: 1, updatedAt: new Date('2026-10-17T12:00:00Z'), ...extra };
    jest.spyOn(security, 'decrypt').mockImplementation(() => { if (decoded instanceof Error) throw decoded; return JSON.stringify(decoded); });
    const db: any = { emailDelivery: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([job]) } };
    const worker = new MailTransportFactory(db);
    (worker as any).config.accounts.INFO.user = 'current@example.test';
    const transport = jest.spyOn(worker, 'getTransport');
    await worker.tickDeferred();
    expect(db.emailDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { id: job.id, status: 'WAITING_QUOTA', updatedAt: job.updatedAt },
      data: { status: 'REVIEW_REQUIRED', readyAt: null, errorCode },
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
