import { simpleParser } from 'mailparser';
import { MailboxSenderService } from '../mailbox/mailbox-sender.service';
import { MailboxCampaignService } from '../mailbox/mailbox-campaign.service';
import { MailTransportFactory } from './mail-transport.factory';
import { EmailSenderKey } from './email.types';
import { compileMailMessage } from './mail-message';
import { encrypt } from '../mailbox/mailbox-security';
import * as quota from './mail-account-quota';

describe('global footer in the actual outgoing MIME paths', () => {
  const environment = { ...process.env };
  beforeEach(() => {
    process.env.MAILBOX_SEND_ENABLED = 'true'; process.env.MAILBOX_WORKER_ENABLED = 'true';
    process.env.MAILBOX_CAMPAIGN_ENABLED = 'true'; process.env.MAILBOX_CAMPAIGN_PROVIDER_VERIFIED = 'true';
    process.env.MAILBOX_CAMPAIGN_DAILY_LIMIT = '1000'; process.env.API_PUBLIC_URL = 'https://cronox.es';
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'test';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({ test: Buffer.alloc(32, 4).toString('base64') });
  });
  afterEach(() => { process.env = { ...environment }; jest.restoreAllMocks(); });
  const check = async (raw: Buffer, body: string) => {
    const mime = await simpleParser(raw);
    expect(String(mime.html)).toContain(body);
    expect(String(mime.html).match(/data-cronox-global-footer="v1"/g)).toHaveLength(1);
    expect(mime.text).toContain('CRONOX · Contacto y preferencias');
    return mime;
  };
  const memory = () => {
    const stored = new Map<string, Buffer>([['attachment', Buffer.from('privado')]]);
    return { read: jest.fn(async (key: string) => stored.get(key)), remove: jest.fn(),
      write: jest.fn(async (stream: any) => {
        const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        stored.set('wire', Buffer.concat(chunks)); return { key: 'wire' };
      }) };
  };

  it('covers a mailbox reply while retaining its attachment, thread and original body', async () => {
    const box = { id: 'box', active: true, address: 'support@cronox.es', fromName: 'CRONOX', sentCopy: 'provider' };
    const draft = { id: 'draft', mailboxId: box.id, mailbox: box, mode: 'reply', to: 'fixture@example.test', cc: '', bcc: '',
      subject: 'Respuesta', text: 'Respuesta original', html: '<p>Respuesta original</p>', inReplyTo: '<original@cronox.es>', references: ['<original@cronox.es>'],
      files: [{ key: 'attachment', name: 'nota.txt', size: 7 }] };
    const job = { id: 'send', status: 'PENDING', draft, userId: 7, messageId: '<reply@cronox.es>' };
    const db: any = { mailboxSend: { findUnique: jest.fn().mockResolvedValue(job), update: jest.fn() },
      mailboxDraft: { update: jest.fn() }, mailboxStorageGarbage: { create: jest.fn() }, mailbox: { findUniqueOrThrow: jest.fn().mockResolvedValue(box) } };
    const smtp = { sendMail: jest.fn().mockResolvedValue({ messageId: job.messageId, accepted: ['fixture@example.test'] }), close: jest.fn() };
    const files = memory(), access: any = { box: jest.fn(), audit: jest.fn() };
    const leases: any = { run: async (_id: string, fn: any) => fn('lease', async () => {}), commit: async () => ({ count: 1 }) };
    const sessions: any = { validate: async () => ({ userId: 7, user: { role: 'SUPERADMIN' } }) };
    const service = new MailboxSenderService(db, sessions, access, files as any, {} as any, { smtp: async () => smtp } as any, leases);
    await service.process('send'); expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    const mime = await check(smtp.sendMail.mock.calls[0][0].raw, 'Respuesta original');
    expect(mime.inReplyTo).toBe(draft.inReplyTo); expect(mime.messageId).toBe(job.messageId);
    expect(mime.attachments[0].content.toString()).toBe('privado');
  });

  it('adds one footer to a previously frozen circle campaign without changing its version', async () => {
    const box = { id: 'box', active: true, address: 'info@cronox.es', fromName: 'CRONOX' };
    const content = { circle: 3, familyId: 'family', templateId: 'tpl', templateRevision: 1, wireFrozen: true,
      subject: 'Novedades', html: '<p>Campaña congelada</p><p>Recibes esta comunicación por tu suscripción a CRONOX. <a href="__CRONOX_UNSUBSCRIBE_URL__">Darme de baja</a></p>',
      text: 'Campaña congelada\n\nRecibes esta comunicación por tu suscripción a CRONOX. Darme de baja: __CRONOX_UNSUBSCRIBE_URL__' };
    const snapshot = { modelVersion: 2, userId: 7, fromName: 'CRONOX', familyId: 'family', versions: [content], files: [] };
    const delivery = { id: 'delivery', email: 'fixture@example.test', circleLevel: 3, content, messageId: '<campaign@cronox.es>', attempts: 0 };
    const original = JSON.stringify(snapshot);
    const db: any = { mailboxCampaign: { findMany: async () => [{ id: 'campaign', snapshot, draft: { mailboxId: box.id, mailbox: box } }],
      findUniqueOrThrow: async () => ({ cancelledAt: null }) }, user: { findUnique: async () => ({ id: 7, role: 'SUPERADMIN', accountState: 'ACTIVE' }) },
      mailbox: { findUniqueOrThrow: async () => box }, mailboxCampaignDelivery: { update: jest.fn() }, mailboxStorageGarbage: { create: jest.fn() } };
    const files = memory(), smtp = { sendMail: jest.fn().mockResolvedValue({ accepted: [delivery.email] }), close: jest.fn() };
    const access: any = { box: jest.fn() }, leases: any = { run: async (_id: string, fn: any) => fn('lease', async () => {}), commit: async () => delivery };
    const service = new MailboxCampaignService(db, access, {} as any, files as any, { smtp: async () => smtp } as any, leases);
    jest.spyOn(service as any, 'eligible').mockResolvedValue(true); jest.spyOn(service, 'finish').mockResolvedValue();
    await service.tick(); expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    const mime = await check(smtp.sendMail.mock.calls[0][0].raw, 'Campaña congelada');
    expect(mime.text).toContain('Actualiza tus preferencias');
    expect(mime.headerLines.some(header => header.key === 'list-unsubscribe')).toBe(true); expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('upgrades old deferred MIME and retains the original Message-ID and attachments', async () => {
    const original = await compileMailMessage('orders@example.test', { to: 'fixture@example.test', subject: 'Pedido', text: 'Pedido diferido',
      html: '<p>Pedido diferido</p>', messageId: '<deferred@cronox.es>', attachments: [{ filename: 'nota.txt', content: Buffer.from('privado') }] });
    const payload = { raw: original.raw.toString('base64'), envelope: original.envelope };
    const job = { id: 'deferred', senderKey: 'ORDERS', purpose: 'ORDER_CONFIRMATION', status: 'WAITING_QUOTA', quotaUnits: 1,
      pendingPayload: encrypt(JSON.stringify(payload), 'deferred:queued-email') };
    const db: any = { emailDelivery: { findMany: async () => [job], updateMany: jest.fn(), update: jest.fn() } };
    db.$transaction = async (fn: any) => fn({ ...db, $queryRaw: async () => [{ id: job.id }] });
    jest.spyOn(quota, 'reserveAccountQuota').mockResolvedValue(undefined);
    const factory = new MailTransportFactory(db);
    (factory as any).config.accounts.ORDERS.user = 'orders@example.test';
    jest.spyOn(factory, 'getFrom').mockReturnValue('orders@example.test');
    const smtp = { sendMail: jest.fn().mockResolvedValue({ messageId: original.messageId, accepted: ['fixture@example.test'] }) };
    jest.spyOn(factory, 'getTransport').mockReturnValue(smtp as any);
    await factory.tickDeferred(); expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    const mime = await check(smtp.sendMail.mock.calls[0][0].raw, 'Pedido diferido');
    expect(mime.messageId).toBe(original.messageId); expect(mime.attachments[0].content.toString()).toBe('privado');
  });

  it.each(Object.values(EmailSenderKey))('automatically covers future emails from %s', async sender => {
    const db: any = { emailDelivery: { create: async () => ({ id: 'attempt' }), update: jest.fn() } };
    db.$transaction = async (fn: any) => fn(db);
    jest.spyOn(quota, 'reserveAccountQuota').mockResolvedValue(undefined);
    const factory = new MailTransportFactory(db), smtp = { sendMail: jest.fn().mockResolvedValue({ accepted: ['fixture@example.test'], messageId: 'fake' }) };
    jest.spyOn(factory, 'getFrom').mockReturnValue('support@cronox.es'); jest.spyOn(factory, 'getTransport').mockReturnValue(smtp as any);
    await factory.sendMail(sender, { to: 'fixture@example.test', subject: 'Nuevo evento', html: '<p>Evento futuro</p>' }, 'FUTURE_EVENT');
    await check(smtp.sendMail.mock.calls[0][0].raw, 'Evento futuro');
  });
});
