import { MailTransportFactory } from './mail-transport.factory';
import { EmailSenderKey } from './email.types';

describe('durable email delivery history', () => {
  const setup = () => {
    const db: any = { emailDelivery: { create: jest.fn().mockResolvedValue({ id: 'attempt' }), update: jest.fn() } };
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
    expect(db.emailDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SMTP_ACCEPTED', providerMessageId: 'id' } }));
  });
  it('sends nothing if recording the attempt fails', async () => {
    const { db, factory, sendMail } = setup(); db.emailDelivery.create.mockRejectedValue(new Error('db'));
    await expect(factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test' })).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it.each([['EAUTH', 'FAILED'], ['ETIMEDOUT', 'UNKNOWN']])('records %s without exposing raw server errors', async (code, status) => {
    const { db, factory, sendMail } = setup(); sendMail.mockRejectedValue(Object.assign(new Error('secret SMTP data'), { code }));
    await expect(factory.sendMail(EmailSenderKey.INFO, { to: 'test@example.test' })).rejects.toThrow();
    expect(db.emailDelivery.update.mock.calls[0][0].data.status).toBe(status);
    expect(JSON.stringify(db.emailDelivery.update.mock.calls)).not.toContain('secret SMTP data');
  });
});
