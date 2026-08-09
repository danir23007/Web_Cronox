import { createHash } from 'crypto';
import { NewsletterService } from './newsletter.service';

describe('NewsletterService verification flow', () => {
  const originalEnvironment = { ...process.env };
  let tx: any;
  let prisma: any;
  let emailService: any;
  let service: NewsletterService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'http://localhost:3000';

    tx = {
      newsletterSubscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      discountCode: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
      newsletterSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    emailService = {
      isEnabled: jest.fn().mockReturnValue(true),
      sendNewsletterConfirmation: jest
        .fn()
        .mockResolvedValue({ messageId: 'message-id' }),
      sendFirstOrderDiscount: jest.fn(),
    };
    service = new NewsletterService(prisma, emailService);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
  });

  it('creates a standalone pending subscription rather than preempting a User account', async () => {
    await expect(service.subscribe('NEW@example.test')).resolves.toEqual({
      status: 'accepted',
      httpStatus: 202,
    });

    const storedHash =
      tx.newsletterSubscription.create.mock.calls[0][0].data
        .verificationTokenHash;
    const verificationUrl =
      emailService.sendNewsletterConfirmation.mock.calls[0][1];
    const rawToken = new URL(verificationUrl).searchParams.get('token');

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(storedHash).toBe(
      createHash('sha256')
        .update(rawToken as string)
        .digest('hex'),
    );
    expect(storedHash).not.toBe(rawToken);
  });

  it('does not create a pending token while email delivery is disabled', async () => {
    emailService.isEnabled.mockReturnValue(false);

    await expect(service.subscribe('new@example.test')).resolves.toEqual({
      status: 'accepted',
      httpStatus: 202,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emailService.sendNewsletterConfirmation).not.toHaveBeenCalled();
  });
});
