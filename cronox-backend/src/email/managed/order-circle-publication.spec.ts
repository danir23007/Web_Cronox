import { ManagedMailService } from './managed-mail.service';
import { EmailSenderKey } from '../email.types';
import { mailPreviewData } from './welcome-design';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { orderPublicationKey } from './order-confirmation-design';

const snapshot = (circle: number) => ({ id: `t${circle}`, folderId: `f${circle}`, senderKey: 'ORDERS', purpose: 'ORDER_CONFIRMATION',
  name: `Confirmación ${circle}`, subject: `Círculo ${circle}: {{orderId}}`, preheader: '', signatureMode: 'none', signatureId: null,
  revision: 1, archivedAt: null, document: { ...structuredDocumentForPurpose('ORDER_CONFIRMATION')!, orderCircle: circle } });
describe('order confirmation publications belong to their own circle', () => {
  it.each([1, 2, 3, 4, 5])('publishes an immutable circle %s snapshot in an independent slot', async circle => {
    const t = snapshot(circle);
    const db: any = { $transaction: (run: any) => run(db),
      managedEmailTemplate: { findFirst: jest.fn().mockResolvedValue(t), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      emailTemplateFolder: { findFirst: jest.fn().mockResolvedValue({ id: t.folderId, name: `Círculo ${circle}` }) },
      emailTemplateVersion: { create: jest.fn().mockResolvedValue({ id: 'version' }) },
      emailPublication: { upsert: jest.fn() }, auditLog: { create: jest.fn() } };
    const transport = { sendMail: jest.fn() }, service = new ManagedMailService(db, transport as any);
    await service.action(EmailSenderKey.ORDERS, t.id, { action: 'publish', confirmed: true, revision: 1 });
    expect(db.emailPublication.upsert.mock.calls[0][0]).toMatchObject({ where: { senderKey_purpose: { senderKey: 'ORDERS', purpose: orderPublicationKey(circle) } } });
    expect(db.emailTemplateVersion.create.mock.calls[0][0].data.snapshot.document.orderCircle).toBe(circle);
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3, 4, 5])('selects the published snapshot for recipient circle %s', async circle => {
    const db: any = { emailPublication: { findUnique: jest.fn(({ where }) => {
      const n = Number(where.senderKey_purpose.purpose.at(-1));
      return Promise.resolve({ version: { snapshot: snapshot(n) } });
    }) } };
    const service = new ManagedMailService(db, {} as any);
    const result = await service.published(EmailSenderKey.ORDERS, 'ORDER_CONFIRMATION', { ...mailPreviewData('ORDER_CONFIRMATION'), circleLevel: circle });
    expect(result!.subject).toBe(`Círculo ${circle}: CRX-1042`);
    expect(result!.html).toContain(`class="order-circle-canvas order-circle-${circle}"`);
    expect(db.emailPublication.findUnique).toHaveBeenCalledTimes(1);
  });
  it('keeps a legacy global publication only for the circle to which it belongs', async () => {
    const db: any = { emailPublication: { findUnique: jest.fn(({ where }) => Promise.resolve(
      where.senderKey_purpose.purpose === 'ORDER_CONFIRMATION' ? { version: { snapshot: snapshot(2) } } : null)) } };
    const service = new ManagedMailService(db, {} as any), data = mailPreviewData('ORDER_CONFIRMATION');
    expect(await service.published(EmailSenderKey.ORDERS, 'ORDER_CONFIRMATION', { ...data, circleLevel: 3 })).toBeNull();
    expect((await service.published(EmailSenderKey.ORDERS, 'ORDER_CONFIRMATION', { ...data, circleLevel: 2 }))!.subject).toBe('Círculo 2: CRX-1042');
  });
  it('derives the editable circle from its folder, ignoring a copied document or posted sample circle', async () => {
    const db: any = { emailTemplateFolder: { findFirst: jest.fn().mockResolvedValue({ name: 'Círculo 2' }) } };
    const service = new ManagedMailService(db, {} as any);
    const result = await service.render('ORDERS', { ...snapshot(5), folderId: 'f2' }, { ...mailPreviewData('ORDER_CONFIRMATION'), circleLevel: 5 });
    expect(result.html).toContain('class="order-circle-canvas order-circle-2"');
  });
});
