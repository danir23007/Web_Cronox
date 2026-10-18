import { EmailService } from './email.service';
import { EmailType } from './email.types';

describe('EmailService account setup', () => {
  it('uses an existing-account purpose and copy, with a valid order and recovery action', async () => {
    const service = new EmailService({} as any);
    const send = jest.spyOn(service, 'send').mockResolvedValue({ messageId: 'fixture' });
    await service.sendInitialPasswordSetup('existing@example.test', 'https://fixture.test/reset#token=fixture', { scenario: 'EXISTING_PASSWORDLESS', orderId: 85 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'PASSWORD_SETUP_EXISTING_ACCOUNT',
      subject: 'CRONOX · Configura tu contraseña y consulta tu pedido', templateData: expect.objectContaining({ orderId: '85', actionLabel: 'Configurar contraseña' }) }));
    expect(JSON.stringify(send.mock.calls[0][0])).not.toMatch(/hemos creado|cuenta ha sido creada|nueva cuenta/i);
  });
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

    await service.sendInitialPasswordSetup('new@example.test', setupUrl, { scenario: 'NEW_ACCOUNT', orderId: 42 });

    expect(send).toHaveBeenCalledWith({
      purpose: 'PASSWORD_SETUP_NEW_ACCOUNT',
      type: EmailType.PASSWORD_RESET,
      to: 'new@example.test',
      subject: 'CRONOX · Tu cuenta está lista: configura tu contraseña',
      templateData: {
        title: 'Tu cuenta está lista: configura tu contraseña',
        message:
          'Hemos creado una cuenta asociada al email utilizado en tu compra para que puedas consultar tus pedidos. Configura una contraseña para acceder.',
        orderId: '42',
        recoveryUrl: expect.stringContaining('/recuperar-contrasena'),
        actionUrl: setupUrl,
        actionLabel: 'Configurar contraseña',
      },
    });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('passwordHash');
  });
});
