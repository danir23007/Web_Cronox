import { MailboxCampaignService } from './mailbox-campaign.service';
import * as policy from './mailbox-campaign-policy';
import { MailboxService } from './mailbox.service';
import { MailboxController } from './mailbox.controller';

describe('A retired campaign owner cannot resolve to a reused account number', () => {
  it.each(['deleted:2', 0, null])('keeps campaign %s inactive without looking up a user or sending mail', async userId => {
    const previous = process.env.MAILBOX_SEND_ENABLED;
    process.env.MAILBOX_SEND_ENABLED = 'true';
    const policySpy = jest.spyOn(policy, 'campaignPolicy').mockReturnValue({ ready: true } as any);
    const db = {
      mailboxCampaign: {
        findMany: jest.fn().mockResolvedValue([{ id: 'campaign', snapshot: { modelVersion: 2, userId }, draft: { mailboxId: 'box', mailbox: { id: 'box', address: 'info@cronox.es', active: true } } }]),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    const provider = { smtp: jest.fn() };
    const access = { box: jest.fn() };
    const leases = { run: jest.fn(async (_id, work) => work('lease', jest.fn())), commit: jest.fn() };
    try {
      await new MailboxCampaignService(db as any, access as any, {} as any, {} as any, provider as any, leases as any).tick();
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(access.box).not.toHaveBeenCalled();
      expect(provider.smtp).not.toHaveBeenCalled();
      expect(leases.commit).not.toHaveBeenCalled();
      expect(db.mailboxCampaign.update).toHaveBeenCalledWith({ where: { id: 'campaign' }, data: { errorCode: 'MAILBOX_CAMPAIGN_OWNER_OR_BOX_INACTIVE' } });
    } finally {
      policySpy.mockRestore();
      if (previous === undefined) delete process.env.MAILBOX_SEND_ENABLED;
      else process.env.MAILBOX_SEND_ENABLED = previous;
    }
  });
});

describe('Mailbox grants retain the selected account identity', () => {
  const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const config = {
    name: 'Local mailbox', address: 'local@example.test', fromName: 'CRONOX',
    username: 'local@example.test', provider: 'hostinger', active: false,
    imapHost: 'imap.hostinger.com', imapPort: 993,
    smtpHost: 'smtp.hostinger.com', smtpPort: 465,
  };
  it.each([undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])('rejects stale or absent UUID %s before updating permissions', async identityUid => {
    const db = { user: { findMany: jest.fn().mockResolvedValue([{ id: 2, identityUid: uid }]) }, $transaction: jest.fn() };
    const service = new MailboxService(db as any, { superadmin: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.configure({ id: 1, role: 'SUPERADMIN' }, undefined, { ...config, permissions: [{ userId: 2, identityUid, access: 'read' }] })).rejects.toThrow('MAILBOX_PERMISSION_USER_CHANGED');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('preserves a valid grant with its current UUID', async () => {
    const permission = { deleteMany: jest.fn(), create: jest.fn() };
    const db = { user: { findMany: jest.fn().mockResolvedValue([{ id: 2, identityUid: uid }]) }, $transaction: jest.fn(async work => work({ mailbox: { create: jest.fn() }, mailboxPermission: permission })) };
    const service = new MailboxService(db as any, { superadmin: jest.fn(), audit: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'overview').mockResolvedValue({} as any);
    await service.configure({ id: 1, role: 'SUPERADMIN' }, undefined, { ...config, permissions: [{ userId: 2, identityUid: uid, access: 'read' }] });
    expect(permission.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 2, access: 'read' }) });
  });
});

describe('Attachment stream revalidation after revocation', () => {
  it('checks session under the shared gate before mailbox access and prevents overlapping checks', async () => {
    let tick: () => void = () => {};
    const timer = jest.spyOn(global, 'setInterval').mockImplementation(((callback: () => void) => { tick = callback; return { unref: jest.fn() }; }) as any);
    const stream = { destroy: jest.fn(), on: jest.fn(), pipe: jest.fn() };
    const res = { destroyed: false, setHeader: jest.fn(), on: jest.fn(), destroy: jest.fn() };
    const sessions = { validate: jest.fn().mockRejectedValue(new Error('SESSION_REAUTH_REQUIRED')) };
    const access = { box: jest.fn() };
    const gate = { shared: jest.fn(async work => work()) };
    const controller = new MailboxController({} as any, { file: jest.fn().mockResolvedValue({ mailboxId: 'box', name: 'local.txt', stream }) } as any, {} as any, access as any, sessions as any, {} as any, gate as any);
    try {
      await controller.download({ user: { id: 2, role: 'ADMIN' }, authSession: { sid: 'old-session', sv: 0 } } as any, 'file', res as any);
      tick(); tick();
      await new Promise(resolve => setImmediate(resolve));
      expect(gate.shared).toHaveBeenCalledTimes(1);
      expect(sessions.validate).toHaveBeenCalledTimes(1);
      expect(access.box).not.toHaveBeenCalled();
      expect(stream.destroy).toHaveBeenCalled();
      expect(res.destroy).toHaveBeenCalled();
    } finally { timer.mockRestore(); }
  });
});
