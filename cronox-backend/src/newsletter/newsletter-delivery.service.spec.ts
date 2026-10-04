import { NewsletterDeliveryService } from './newsletter-delivery.service';
import { EmailQuotaWaitError } from '../email/mail-account-quota';

it('preserves newsletter jobs at quota exhaustion without burning retries or claiming SMTP acceptance', async () => {
  const readyAt = new Date(Date.now()+86400000);
  const db: any = {
    newsletterMailJob: { findFirst: jest.fn().mockResolvedValue({id:'job',email:'buyer@example.test',kind:'WELCOME',attempts:12}), updateMany:jest.fn() },
    newsletterSubscription: { findUnique:jest.fn().mockResolvedValue({subscribedAt:new Date(),welcomeSentAt:null}) },
  };
  const email: any = {sendNewsletterWelcome:jest.fn().mockRejectedValue(new EmailQuotaWaitError(readyAt))};
  await new NewsletterDeliveryService(db,email).dispatch('job','claim');
  expect(db.newsletterMailJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({
    status:'QUEUED',readyAt,attempts:{decrement:1},errorCode:'EMAIL_QUOTA_WAITING',claimToken:null,tokenHash:null,
  })}));
});
