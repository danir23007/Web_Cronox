import { EmailService } from './email.service';
import { EmailType } from './email.types';

describe('EmailService account setup', () => {
  it.each([{ accepted: [] }, { accepted: ['buyer@example.test'] }])('requires SMTP recipient acceptance (%j)', async ({ accepted }) => {
    const transport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'mail-1', accepted }) };
    const service = new EmailService({ sendMail: (_key: string, options: any) => transport.sendMail(options) } as any);
    (service as any).config.enabled = true;
    jest.spyOn(service as any, 'renderTemplate').mockResolvedValue('<p>Order</p>');
    const result = service.send({ type: EmailType.ORDER_CONFIRMATION, to: 'buyer@example.test', subject: 'Order', templateData: {} });
    if (accepted.length) await expect(result).resolves.toEqual({ messageId: 'mail-1' });
    else await expect(result).rejects.toThrow('No se pudo enviar el email');
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
