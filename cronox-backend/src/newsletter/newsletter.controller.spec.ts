import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewsletterController } from './newsletter.controller';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';

describe('Newsletter public responses', () => {
  it.each([true, false])('retires old confirmation links without activating any subscription (%s)', async confirmed => {
    const service = { confirm: jest.fn().mockResolvedValue(confirmed) };
    const response: any = { setHeader: jest.fn(), redirect: jest.fn() };
    await new NewsletterController(service as any).confirm('private-test-token', response);
    expect(response.redirect).toHaveBeenCalledWith(303, '/');
    expect(service.confirm).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it.each(['invalid', 'a@', '<bad>@example.test'])('rejects invalid email %s before subscribing', async email => {
    expect(await validate(plainToInstance(NewsletterSubscribeDto, { email }))).not.toHaveLength(0);
  });
});
