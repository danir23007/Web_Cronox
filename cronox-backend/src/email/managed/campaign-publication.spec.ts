import { campaignPublicationKey, manualCampaignScope } from './campaign-publication';
import { MailboxErrorFilter, SaveCampaignSelectionDto, SendCampaignSelectionDto } from '../../mailbox/mailbox.controller';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

describe('manual publication scope and saved campaign identifiers', () => {
  const template = { senderKey: 'INFO', purpose: null, familyId: 'family-one', campaignCircle: 2, folderId: 'folder', archivedAt: null };
  const db: any = { campaignTemplateFamily: { findUnique: jest.fn(async () => ({ id: 'family-one' })) }, emailTemplateFolder: { findFirst: jest.fn(async () => ({ name: 'Círculo 2' })) } };
  it('uses a family and circle namespace disjoint from automatic purposes and other families', async () => {
    expect(await manualCampaignScope(db, 'INFO', template)).toMatchObject({ circle: 2, publicationKey: 'CAMPAIGN_FAMILY:family-one:CIRCLE_2' });
    expect(campaignPublicationKey('family-one', 2)).not.toBe(campaignPublicationKey('family-two', 2));
    expect(campaignPublicationKey('family-one', 2)).not.toBe('GENERIC:CIRCLE_2');
  });
  it.each([{ senderKey: 'SUPPORT' }, { purpose: 'GENERIC' }, { familyId: null }, { archivedAt: new Date() }, { campaignCircle: 3 }])('rejects an invalid manual relationship: %o', async change => {
    await expect(manualCampaignScope(db, 'INFO', { ...template, ...change })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([SaveCampaignSelectionDto, SendCampaignSelectionDto])('accepts the persisted stable ID through the real validation pipe: %p', async metatype => {
    const value = { draftId: 'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026', revision: 1, familyId: 'campaign:INFO:BLACK_FRIDAY_NUMBERS_2026', circles: [1,2,3,4,5], ...(metatype === SendCampaignSelectionDto ? { requestKey: randomUUID(), previewHash: 'a'.repeat(64) } : {}) };
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform(value, { type: 'body', metatype })).resolves.toMatchObject({ draftId: value.draftId });
  });
  it.each(['../outside', 'contains spaces', 'a'.repeat(101), 42])('rejects an invalid ID without weakening owner checks: %s', async draftId => {
    const pipe = new ValidationPipe({ transform: true });
    await expect(pipe.transform({ draftId, revision: 1 }, { type: 'body', metatype: SaveCampaignSelectionDto })).rejects.toThrow();
  });
  it('preserves a specific error for the frontend without exposing input values', () => {
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    new MailboxErrorFilter().catch(new BadRequestException({ message: ['MAILBOX_INVALID_DRAFT_ID'] }), { switchToHttp: () => ({ getResponse: () => res }) } as any);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 400, message: 'MAILBOX_INVALID_DRAFT_ID' });
  });
  it('diagnoses the single-connection pool failure without logging Prisma arguments or personal data', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      new MailboxErrorFilter().catch({ name: 'PrismaClientKnownRequestError', code: 'P2024', message: 'private-customer@example.test SECRET_BODY' }, { switchToHttp: () => ({ getResponse: () => res }) } as any);
      expect(res.json).toHaveBeenCalledWith({ statusCode: 503, message: 'MAILBOX_DATABASE_UNAVAILABLE', reference: expect.any(String) });
      const log = JSON.parse(logger.mock.calls[0][0]);
      expect(log).toEqual({ reference: res.json.mock.calls[0][0].reference, code: 'P2024', exception: 'PrismaClientKnownRequestError' });
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(/private-customer|SECRET_BODY/);
    } finally { logger.mockRestore(); }
  });
});
