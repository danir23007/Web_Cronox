import ExcelJS from 'exceljs';
import { campaignAudience } from './campaign-plan';
import { MailboxCampaignService } from './mailbox-campaign.service';

const user = (id: number, role = 'USER', extra = {}) => ({ id, email: `person${id}@example.test`, name: '', circleLevel: 1, accountState: 'ACTIVE', newsletterSubscribed: true, role, ...extra });
describe('one campaign audience for every role and delivery', () => {
  const users = ['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN', 'FUTURE_ROLE'].map((role, i) => user(i + 1, role));
  function service(rows = users, suppressed: any[] = []) {
    const db: any = { user: { findMany: jest.fn(async () => rows) }, mailboxSuppression: { findMany: jest.fn(async () => suppressed) } };
    return new MailboxCampaignService(db, { box: async () => ({ address: 'info@cronox.es' }) } as any, null as any, null as any, null as any, null as any);
  }
  it('counts, selects and revalidates every role with no role predicate', async () => {
    const s = service();
    expect(await s.recipients([1])).toHaveLength(5);
    for (const u of users) expect(await s.eligible(u.email, 1)).toBe(true);
    expect(s.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { circleLevel: { in: [1,2,3,4,5] } } }));
  });
  it('explains every selected account including duplicates, invalid addresses, inactivity and refusals', () => {
    const rows = [...users, user(6, 'ADMIN', { newsletterSubscribed: false }), user(7, 'USER', { accountState: 'DISABLED' }), user(8, 'USER', { email: 'invalid' }), user(9), user(10, 'USER', { email: users[0].email.toUpperCase() }), user(11, 'USER', { circleLevel: 2 })];
    const a = campaignAudience(rows, [{ email: 'person9@example.test', reason: 'UNSUBSCRIBED' }], [1]);
    expect(a.totalUsers).toBe(10); expect(a.recipients).toHaveLength(5); expect(a.excluded).toHaveLength(5);
    expect(a.exclusionCounts).toEqual({ NO_SUBSCRIPTION_EVIDENCE: 1, ACCOUNT_DISABLED: 1, INVALID_EMAIL: 1, SUPPRESSION_UNSUBSCRIBED: 1, DUPLICATE_EMAIL: 1 });
  });
  it('revalidates a new withdrawal immediately before delivery, including administrators', async () => {
    const rows = users.map(u => ({ ...u })); const suppressed: any[] = []; const s = service(rows, suppressed);
    expect(await s.eligible(rows[2].email, 1)).toBe(true);
    suppressed.push({ email: rows[2].email, reason: 'UNSUBSCRIBED' });
    expect(await s.eligible(rows[2].email, 1)).toBe(false);
    rows[3].newsletterSubscribed = false;
    expect(await s.eligible(rows[3].email, 1)).toBe(false);
    expect(await s.eligible(rows[4].email, 2)).toBe(false);
  });
  it('exports exactly the calculated recipients and explains exclusions in a second sheet', async () => {
    const s = service([...users, user(6, 'USER', { newsletterSubscribed: false })]);
    const a = await s.resolveRecipients([1]);
    jest.spyOn(s, 'selection').mockResolvedValue({} as any);
    jest.spyOn(s, 'plan').mockResolvedValue({ ...a, count: a.recipients.length } as any);
    const bytes = await s.exportAudience({ id: 1, role: 'SUPERADMIN' }, 'info', {});
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as any);
    expect(book.getWorksheet('Destinatarios')!.actualRowCount - 1).toBe(a.recipients.length);
    expect(book.getWorksheet('Excluidos')!.actualRowCount - 1).toBe(a.excluded.length);
    expect(a.totalUsers).toBe(a.recipients.length + a.excluded.length);
  });
});
