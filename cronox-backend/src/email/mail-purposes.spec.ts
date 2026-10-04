import { EmailService } from './email.service';
import { EmailSenderKey, EmailType } from './email.types';
import { MAIL_PURPOSES } from './managed/mail-catalog';
import { structuredDocumentForPurpose } from './managed/mail-template-documents';
import { renderMail } from './managed/mail-renderer';

const retired = ['PRE_REGISTRATION_CONFIRMATION', 'LAUNCH', 'NEWSLETTER_CONFIRMATION', 'FIRST_ORDER_DISCOUNT', 'GENERIC', 'TEST'];
describe('CRONOX mail purposes', () => {
  const setup = (custom?: any) => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'local', accepted: ['local@example.test'] });
    const published = jest.fn().mockResolvedValue(custom);
    return { service: new EmailService({ sendMail } as any, { published } as any), sendMail, published };
  };
  it.each(retired)('removes and rejects %s without SMTP', async purpose => {
    expect(MAIL_PURPOSES.some(p => p.key === purpose)).toBe(false);
    const { service, sendMail } = setup();
    await expect(service.send({ type: EmailType.GENERIC, purpose: purpose as any, to: 'local@example.test', subject: 'Local' })).rejects.toThrow('retirada');
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('routes access, welcome and restock to the configured No-reply transport and publications', async () => {
    const { service, sendMail, published } = setup();
    await service.sendNewsletterAccess('local@example.test', 'https://example.test/access', true, 'bavolima');
    await service.sendNewsletterWelcome('local@example.test', 'ABC234');
    await service.sendRestock('local@example.test', { product: 'Camiseta', size: 'M', actionUrl: 'https://example.test/product' });
    expect(sendMail.mock.calls.map(call => call[0])).toEqual(Array(3).fill(EmailSenderKey.NOREPLY));
    expect(published.mock.calls.map(call => call[0])).toEqual(Array(3).fill(EmailSenderKey.NOREPLY));
    expect(sendMail.mock.calls[0][1].html).toContain('bavolima');
    expect(sendMail.mock.calls[0][1].html).toContain('&quot;bavolima&quot;');
    expect(sendMail.mock.calls[0][1].html).toContain('sin las comillas');
    expect(sendMail.mock.calls[1][1].html).toContain('ABC234');
    expect(sendMail.mock.calls[1][1].html).toContain('10%');
    expect(sendMail.mock.calls[0][1].subject).not.toContain('bavolima');
  });
  it('keeps custom designs and supplements an old publication with the mandatory password instructions', async () => {
    const { service, sendMail } = setup({ html: '<body><p>Custom design</p><a href="https://example.test/access">Entrar en CRONOX</a></body>', text: 'Custom design', subject: 'Custom' });
    await service.sendNewsletterAccess('local@example.test', 'https://example.test/access', true, 'bavolima');
    expect(sendMail.mock.calls[0][1].html).toContain('Custom design');
    expect(sendMail.mock.calls[0][1].html).toContain('bavolima');
    expect(sendMail.mock.calls[0][1].text).toContain('bavolima');
  });
  it('preserves the published restock subject, HTML and text on No-reply', async () => {
    const custom = { subject: 'Custom restock subject', html: '<p>Custom restock</p><a href="https://example.test/product">View</a>', text: 'Custom restock text' };
    const { service, sendMail } = setup(custom);
    await service.sendRestock('local@example.test', { product: 'Camiseta', size: 'M', actionUrl: 'https://example.test/product' });
    expect(sendMail.mock.calls[0][0]).toBe(EmailSenderKey.NOREPLY);
    expect(sendMail.mock.calls[0][1]).toMatchObject(custom);
  });
  it.each([undefined, 'bavolima'])('renders editable and fallback access without unresolved variables (%s)', async initialPassword => {
    const { service, sendMail } = setup();
    await service.sendNewsletterAccess('local@example.test', 'https://example.test/access', true, initialPassword);
    const data = { message: 'Access', actionUrl: 'https://example.test/access', actionLabel: 'Entrar en CRONOX',
      initialPassword: initialPassword || '', passwordMessage: initialPassword ? `Tu contrase\u00f1a es: "${initialPassword}". Introd\u00facela sin las comillas.` : '' };
    const editable = renderMail(structuredDocumentForPurpose('NEWSLETTER_ACCESS'), 'Access', '', 'NEWSLETTER_ACCESS', data, undefined, true);
    for (const html of [editable.html, sendMail.mock.calls[0][1].html]) {
      expect(html).not.toContain('{{');
      if (initialPassword) expect(html).toContain(initialPassword);
      else expect(html).not.toContain('sin las comillas');
    }
    expect(() => renderMail(structuredDocumentForPurpose('NEWSLETTER_ACCESS'), '{{initialPassword}}', '', 'NEWSLETTER_ACCESS', data)).toThrow();
  });
  it('checks availability using No-reply credentials independently from Info', () => {
    const { service } = setup();
    const config = (service as any).config;
    config.enabled = true;
    config.accounts.NOREPLY = { user: 'configured-noreply@example.test', pass: 'local-only' };
    config.accounts.INFO = { user: '', pass: '' };
    expect(service.isNewsletterSenderConfigured()).toBe(true);
    expect(service.isRestockSenderConfigured()).toBe(true);
    config.accounts.NOREPLY.pass = '';
    expect(service.isNewsletterSenderConfigured()).toBe(false);
    expect(service.isRestockSenderConfigured()).toBe(false);
  });
});
