import { EmailService } from './email.service';
import { EmailType } from './email.types';

describe('EmailService account setup', () => {
  it('falls back to the first-party template if a newsletter publication loses its confirmation link', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'confirmation', accepted: ['test@example.test'] });
    const service = new EmailService({ getTransport: () => ({ sendMail }), getFrom: () => 'test@example.test' } as any,
      { published: jest.fn().mockResolvedValue({ html: '<p>No action</p>', text: 'No action', subject: 'Custom' }) } as any);
    (service as any).config.enabled = true;
    jest.spyOn(service as any, 'renderTemplate').mockResolvedValue('<a href="https://example.test/confirm?token=test-only">Confirmar</a>');
    await service.sendNewsletterConfirmation('test@example.test', 'https://example.test/confirm?token=test-only');
    expect(sendMail.mock.calls[0][0].html).toContain('token=test-only');
    expect(sendMail.mock.calls[0][0].subject).toContain('Confirma tu suscripción');
  });
  it.each([{ accepted: [] }, { accepted: ['buyer@example.test'] }])('requires SMTP recipient acceptance (%j)', async ({ accepted }) => {
    const transport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'mail-1', accepted }) };
    const service = new EmailService({ getTransport: () => transport, getFrom: () => 'orders@example.test' } as any);
    (service as any).config.enabled = true;
    jest.spyOn(service as any, 'renderTemplate').mockResolvedValue('<p>Order</p>');
    const result = service.send({ type: EmailType.ORDER_CONFIRMATION, to: 'buyer@example.test', subject: 'Order', templateData: {} });
    if (accepted.length) await expect(result).resolves.toEqual({ messageId: 'mail-1' });
    else await expect(result).rejects.toThrow('No se pudo enviar el email');
  });
  it('routes preregistration confirmation through its managed purpose', async () => {
    const service = new EmailService({} as any);
    const send = jest
      .spyOn(service, 'send')
      .mockResolvedValue({ messageId: 'pre-1' });
    const date = new Date('2026-09-10T12:00:00.000Z');
    await service.sendPreRegistrationConfirmation('lead@example.test', date);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EmailType.PRE_REGISTRATION_CONFIRMATION,
        to: 'lead@example.test',
        templateData: expect.objectContaining({
          email: 'lead@example.test',
          preRegistrationDate: date.toISOString(),
        }),
      }),
    );
  });

  it('reuses the CRONOX generic email system with initial-account copy and no password', async () => {
    const service = new EmailService({} as any);
    const send = jest
      .spyOn(service, 'send')
      .mockResolvedValue({ messageId: 'message-1' });
    const setupUrl =
      'https://cronox.example/reset-password?token=one-time-secret-token';

    await service.sendInitialPasswordSetup('new@example.test', setupUrl);

    expect(send).toHaveBeenCalledWith({
      purpose: 'INITIAL_PASSWORD_SETUP',
      type: EmailType.PASSWORD_RESET,
      to: 'new@example.test',
      subject: 'CRONOX · Tu cuenta ha sido creada',
      templateData: {
        title: 'Tu cuenta CRONOX ha sido creada',
        message:
          'Tu compra ya está asociada a tu nueva cuenta. Configura una contraseña para acceder a tus pedidos.',
        actionUrl: setupUrl,
        actionLabel: 'Configurar contraseña',
      },
    });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('passwordHash');
  });
});
