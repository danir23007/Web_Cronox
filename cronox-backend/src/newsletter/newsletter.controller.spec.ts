import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewsletterController } from './newsletter.controller';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';

describe('Newsletter public responses', () => {
  it.each([true, false])('renders the real confirmation result (%s) without the token', async confirmed => {
    const service = { confirm: jest.fn().mockResolvedValue(confirmed) };
    const response: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), type: jest.fn().mockReturnThis(), send: jest.fn() };
    await new NewsletterController(service as any).confirm('private-test-token', response);
    expect(response.status).toHaveBeenCalledWith(confirmed ? 200 : 400);
    expect(response.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    const html = response.send.mock.calls[0][0];
    expect(html).toContain(confirmed ? 'Suscripción confirmada' : 'No se pudo confirmar');
    expect(html).not.toContain('private-test-token');
  });

  it.each(['invalid', 'a@', '<bad>@example.test'])('rejects invalid email %s before subscribing', async email => {
    expect(await validate(plainToInstance(NewsletterSubscribeDto, { email }))).not.toHaveLength(0);
  });
});
