import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NewsletterController } from './newsletter.controller';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

describe('Newsletter public responses', () => {
  it('returns the explicit account confirmation while keeping HTTP 202', async () => {
    const accepted = { status: 'accepted', httpStatus: 202 };
    const service = { subscribe: jest.fn().mockResolvedValueOnce({ ...accepted, confirmation: 'welcome' }).mockResolvedValueOnce({ ...accepted, confirmation: 'existing_account' }), requestAccess: jest.fn().mockResolvedValue(accepted) };
    const controller = new NewsletterController(service as any);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.subscribe)).toBe(202);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.requestAccess)).toBe(202);
    expect(await controller.subscribe({ email: 'first@example.test' })).toEqual({ ...accepted, confirmation: 'welcome' });
    expect(await controller.subscribe({ email: 'existing@example.test' })).toEqual({ ...accepted, confirmation: 'existing_account' });
    expect(await controller.requestAccess({ email: 'unknown@example.test' })).toEqual(accepted);
    expect(service.subscribe).toHaveBeenCalledTimes(2);
  });

  it('limits each public email-request endpoint to five requests per IP per 15 minutes', () => {
    for (const handler of [NewsletterController.prototype.subscribe, NewsletterController.prototype.requestAccess]) {
      expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBe(5);
      expect(Reflect.getMetadata(THROTTLER_TTL + 'default', handler)).toBe(15 * 60_000);
    }
  });

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
