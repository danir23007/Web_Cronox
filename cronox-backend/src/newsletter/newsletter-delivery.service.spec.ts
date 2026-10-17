import { NewsletterDeliveryService } from './newsletter-delivery.service';
import { EmailQuotaWaitError } from '../email/mail-account-quota';

it.each(['accepted', 'rejected', 'uncertain'])('ACCESS %s never generates credentials before ownership verification', async outcome => {
  const user = { id: 1, email: 'buyer@example.test', role: 'USER', accountState: 'ACTIVE', sessionVersion: 0, password: null, registrationClaimable: true };
  const db: any = {
    $executeRaw: jest.fn(),
    newsletterMailJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job', email: user.email, kind: 'ACCESS', attempts: 3 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findMany: jest.fn().mockResolvedValue([user]), findUnique: jest.fn().mockResolvedValue(user), updateMany: jest.fn() },
  };
  db.$transaction = jest.fn(fn => fn(db));
  const email: any = { sendNewsletterAccess: jest.fn(async () => {
    if (outcome !== 'accepted') throw Object.assign(new Error('fictional transport'), { deliveryUnknown: outcome === 'uncertain' });
  }) };
  await new NewsletterDeliveryService(db, email).dispatch('job', 'claim');
  expect(db.user.updateMany).not.toHaveBeenCalled();
  expect(email.sendNewsletterAccess).toHaveBeenCalledWith(user.email, expect.stringContaining('/newsletter-access.html#'), true);
  expect(db.newsletterMailJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: outcome === 'accepted' ? 'SENT' : outcome === 'uncertain' ? 'UNCERTAIN' : 'FAILED' }) }));
});

it('preserves newsletter jobs at quota exhaustion without burning retries or claiming SMTP acceptance', async () => {
  const readyAt = new Date(Date.now()+86400000);
  const db: any = {
    newsletterMailJob: { findFirst: jest.fn().mockResolvedValue({id:'job',email:'buyer@example.test',kind:'WELCOME',attempts:12}), updateMany:jest.fn().mockResolvedValue({count:1}) },
    newsletterSubscription: { findUnique:jest.fn().mockResolvedValue({subscribedAt:new Date(),welcomeSentAt:null}) },
  };
  const email: any = {sendNewsletterWelcome:jest.fn().mockRejectedValue(new EmailQuotaWaitError(readyAt))};
  await new NewsletterDeliveryService(db,email).dispatch('job','claim');
  expect(db.newsletterMailJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({
    status:'QUEUED',readyAt,attempts:{decrement:1},errorCode:'EMAIL_QUOTA_WAITING',claimToken:null,tokenHash:null,
  })}));
});
