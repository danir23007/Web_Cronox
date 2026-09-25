import { EmailService } from './email.service';
import { restockDeliveryOutcome } from './restock-delivery.error';

describe('Restock email (fake transport only)', () => {
  it('renders the dedicated escaped Spanish template, product, size and URL without launch tokens/codes', async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValue({ accepted: ['buyer@example.test'] });
    const email = new EmailService({
      sendMail: (_key: string, options: any) => sendMail(options),
      getFrom: () => 'info@example.test',
    } as any);
    await email.sendRestock('buyer@example.test', {
      product: '<img src=x onerror=alert(1)>',
      size: 'M',
      actionUrl: 'https://store.example.test/producto/tee?size=M',
      imageUrl: 'https://img.example.test/small.webp',
    });
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe('buyer@example.test');
    expect(message.subject).toBe(
      'Tu talla ha vuelto: <img src=x onerror=alert(1)> · M',
    );
    expect(message.html).toContain('&lt;img');
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('Ya está disponible');
    expect(message.html).toContain('VER PRODUCTO');
    expect(message.html).toContain('Este aviso no reserva la prenda.');
    expect(message.html).toContain('https://img.example.test/small.webp');
    expect(message.html).not.toMatch(/launch\.html|descuento|token=/i);
  });
  it.each([
    [{ responseCode: 450, command: 'DATA' }, 'RETRY'],
    [{ responseCode: 550, command: 'RCPT TO' }, 'FAILED'],
    [{ code: 'EDNS' }, 'RETRY'],
    [{ responseCode: 421, command: 'QUIT' }, 'UNCERTAIN'],
    [{ responseCode: 450 }, 'UNCERTAIN'],
    [
      { responseCode: 450, command: 'DATA', accepted: ['buyer@example.test'] },
      'UNCERTAIN',
    ],
    [{ code: 'ECONNREFUSED' }, 'RETRY'],
    [{ code: 'ETIMEDOUT' }, 'UNCERTAIN'],
    [{ code: 'ECONNRESET' }, 'UNCERTAIN'],
    [{}, 'UNCERTAIN'],
  ])('classifies SMTP failure conservatively: %j', (error, expected) => {
    expect(restockDeliveryOutcome(error)).toBe(expected);
  });
  it('template/config failure occurs before transport and is safe to retry', async () => {
    const sendMail = jest.fn();
    const email = new EmailService({
      sendMail: (_key: string, options: any) => sendMail(options),
    } as any);
    jest
      .spyOn(email as any, 'renderTemplate')
      .mockRejectedValue(new Error('missing template'));
    await expect(
      email.sendRestock('buyer@example.test', {
        product: 'Tee',
        size: 'S',
        actionUrl: 'https://store.example.test/',
      }),
    ).rejects.toMatchObject({ outcome: 'RETRY' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
