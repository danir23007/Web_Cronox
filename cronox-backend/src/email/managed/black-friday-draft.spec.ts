import { JSDOM } from 'jsdom';
import { blackFridayDocument, BLACK_FRIDAY_COPY as copy } from './black-friday-draft';
import { renderMail } from './mail-renderer';
import { composeApplicationMail } from '../mail-footer-composition';
import { saveBlackFridayDrafts } from './black-friday-draft-release';
import { ManagedMailService } from './managed-mail.service';

describe('Black Friday draft content', () => {
  it('keeps exact copy, one mixed-size header, native empty image and block order through rendering', async () => {
    const document = blackFridayDocument();
    const result = renderMail(document, copy.subject, copy.preheader, null);
    expect(result.subject).toBe('11, 22, 33, 44… ¿Y el 77?');
    const dom = new JSDOM(result.html).window.document;
    expect(dom.body.firstElementChild?.textContent).toBe('Los números no son casualidad. Tu próxima prenda, tampoco.');
    const header = dom.querySelector('p')!;
    expect(header.textContent).toBe('Ahora sí, BLACK FRIDAY en CRONOX');
    expect(header.style.fontSize).toBe('19px');
    expect(header.querySelector('strong')?.style.fontSize).toBe('46px');
    expect(header.innerHTML).not.toMatch(/<br|<\/p>.*<p/);
    expect(document.blocks.map(b => b.type)).toEqual(['image', 'rich', 'image', 'text', 'text', 'text', 'button', 'text']);
    expect(document.blocks[2]).toMatchObject({ type: 'image', src: '', alt: '' });
    expect(dom.images[0].alt).toBe('CRONOX');
    expect(dom.images[1].hasAttribute('src')).toBe(false);
    expect(document.blocks[3].text).toBe('11, 22, 33, 44… ¿77?');
    const button = dom.querySelector('a')!;
    expect(button.href).toBe('https://cronox.es/');
    expect(button.textContent).toBe('DESCUBRIR LOS PRECIOS');
    expect(button.style.background).toBe('rgb(255, 255, 255)');
    expect(button.style.color).toBe('rgb(0, 0, 0)');
    const note = document.blocks[7];
    expect(note.text).toBe('Primer Black Friday, probablemente únicas rebajas del año.');
    expect(note.size).toBe(12);
    expect(note.paddingTop).toBe(8);
    const footer = await composeApplicationMail({}, result, { purpose: 'CAMPAIGN', preview: true });
    expect(footer.html).toContain('cronox-global-footer');
    expect(footer.html).toContain('preferencias-correo');
    expect(footer.html).toContain('support@cronox.es');
    expect(footer.html).not.toContain('Déjate corromper');
  });
});

describe('Black Friday additive release', () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture(existing = false) {
    const versions = existing ? [1, 2, 3, 4, 5].map(n => ({ id: `template-${n}`, campaignCircle: n, senderKey: 'INFO' })) : [];
    const draft = { id: 'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026', familyId: 'campaign:INFO:BLACK_FRIDAY_NUMBERS_2026', mailboxId: 'info', status: 'DRAFT' };
    const tx: any = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ kind: 'existing', digest: 'unchanged' }]),
      mailbox: { findUnique: jest.fn().mockResolvedValue({ id: 'info', active: true }) },
      emailSenderProfile: { findUnique: jest.fn().mockResolvedValue({ key: 'INFO' }) },
      mailboxDraft: { findFirst: jest.fn().mockResolvedValue({ userId: 1 }), findUnique: jest.fn().mockResolvedValue(existing ? draft : null), create: jest.fn().mockResolvedValue(draft) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      emailTemplateFolder: { findUnique: jest.fn().mockImplementation(({ where }) => ({ id: where.senderKey_name.name })) },
      campaignTemplateFamily: { findUnique: jest.fn().mockResolvedValue(existing ? { eventKind: 'GENERAL', versions } : null), create: jest.fn() },
      emailTemplateVersion: { count: jest.fn().mockResolvedValue(0) },
      mailboxCampaign: { count: jest.fn().mockResolvedValue(0) },
      mailboxSend: { count: jest.fn().mockResolvedValue(0) },
    };
    const db = { $transaction: (callback: any) => callback(tx) };
    return { db, tx };
  }
  it('creates five native drafts and one all-circle DRAFT using save/link, without publishing or scheduling', async () => {
    const { db, tx } = fixture();
    const save = jest.spyOn(ManagedMailService.prototype, 'save').mockResolvedValue({ id: 'new-template', revision: 1 } as any);
    const link = jest.spyOn(ManagedMailService.prototype, 'linkCampaignVersion').mockResolvedValue({} as any);
    const publish = jest.spyOn(ManagedMailService.prototype, 'action').mockRejectedValue(Error('FORBIDDEN'));
    const result = await saveBlackFridayDrafts(db, true);
    expect(save).toHaveBeenCalledTimes(5);
    expect(link.mock.calls.map(call => call[2])).toEqual([1, 2, 3, 4, 5]);
    for (const call of save.mock.calls) expect(call).toMatchObject(['INFO', { signatureMode: 'default', subject: copy.subject, preheader: copy.preheader }, 1]);
    expect(tx.mailboxDraft.create.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', mode: 'campaign', circles: [1, 2, 3, 4, 5], mailboxId: 'info' });
    expect(publish).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'DRAFT', publishedVersions: 0, campaigns: 0, sends: 0 });
  });
  it.each([false, true])('never overwrites existing content on retry (apply=%s)', async apply => {
    const { db, tx } = fixture(true);
    const save = jest.spyOn(ManagedMailService.prototype, 'save').mockRejectedValue(Error('OVERWRITE_FORBIDDEN'));
    await saveBlackFridayDrafts(db, apply);
    expect(save).not.toHaveBeenCalled();
    expect(tx.campaignTemplateFamily.create).not.toHaveBeenCalled();
    expect(tx.mailboxDraft.create).not.toHaveBeenCalled();
  });
  it('dry run creates nothing', async () => {
    const { db, tx } = fixture();
    await saveBlackFridayDrafts(db);
    expect(tx.campaignTemplateFamily.create).not.toHaveBeenCalled();
    expect(tx.mailboxDraft.create).not.toHaveBeenCalled();
  });
  it('requires the existing active info mailbox', async () => {
    const { db, tx } = fixture();
    tx.mailbox.findUnique.mockResolvedValue({ id: 'info', active: false });
    await expect(saveBlackFridayDrafts(db, true)).rejects.toThrow('EXISTING_INFO_MAILBOX_REQUIRED');
    expect(tx.campaignTemplateFamily.create).not.toHaveBeenCalled();
  });
});
