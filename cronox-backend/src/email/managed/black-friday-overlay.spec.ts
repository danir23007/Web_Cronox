import { JSDOM } from 'jsdom';
import { campaignImage, documentHash, imageDestination, OVERLAY_ALT, updateBlackFridayOverlay, withBlackFridayOverlay } from './black-friday-overlay';
import { blackFridayDocument, BLACK_FRIDAY_FAMILY, BLACK_FRIDAY_DRAFT } from './black-friday-draft';
import { ManagedMailService } from './managed-mail.service';
import { renderMail } from './mail-renderer';

const originalUrl = 'https://images.example.test/owner-original.png';
const derivedUrl = 'https://images.example.test/derived.png';
function editedDocument() {
  const document = blackFridayDocument();
  document.blocks[2] = { ...document.blocks[2], src: originalUrl, width: 640, padding: 0, alt: 'Foto del administrador' };
  document.blocks[4].text = 'Edición manual que se conserva.';
  return document;
}
describe('Black Friday image-only patch', () => {
  it('preserves manual copy and vertical spacing, restoring full width without touching other blocks', () => {
    const current = editedDocument(), before = structuredClone(current);
    const next = withBlackFridayOverlay(current, originalUrl, derivedUrl);
    expect(current).toEqual(before);
    expect(next.blocks.filter((_, i) => i !== 2)).toEqual(before.blocks.filter((_, i) => i !== 2));
    expect(campaignImage(next)).toEqual({ ...campaignImage(before), src: derivedUrl, url: imageDestination(before), alt: OVERLAY_ALT, width: 640, padding: 0, paddingLeft: 0, paddingRight: 0 });
    expect(withBlackFridayOverlay(next, originalUrl, derivedUrl)).toEqual(next);
  });
  it('removes the old narrow image and lateral padding in every circle', () => {
    const current = editedDocument();
    Object.assign(campaignImage(current), { width: 560, padding: 16, paddingLeft: 22, paddingRight: 18 });
    const next = withBlackFridayOverlay(current, originalUrl, derivedUrl);
    expect(campaignImage(next)).toMatchObject({ width: 640, padding: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 24 });
  });
  it('links the whole raster in actual transport HTML without browser overlays', () => {
    const next = withBlackFridayOverlay(editedDocument(), originalUrl, derivedUrl);
    const rendered = renderMail(next, 'Asunto manual', 'Preheader manual', null);
    const dom = new JSDOM(rendered.html).window.document;
    const image = [...dom.images].find(img => img.src === derivedUrl)!;
    expect(image.parentElement?.tagName).toBe('A');
    expect(image.parentElement?.getAttribute('href')).toBe('https://cronox.es/');
    expect(image.alt).toContain('Black Friday ya ha comenzado');
    expect(image.getAttribute('width')).toBe('640');
    expect(image.style.width).toBe('100%');
    expect(image.style.maxWidth).toBe('640px');
    expect(image.hasAttribute('height')).toBe(false);
    expect(image.closest('td')?.style.paddingLeft).toBe('0px');
    expect(image.closest('td')?.style.paddingRight).toBe('0px');
    expect(rendered.html).not.toMatch(/position:absolute|<script|setInterval/);
    expect(rendered.html).toContain('Edición manual que se conserva.');
  });
  it('rejects changed or ambiguous photography instead of replacing it', () => {
    const document = editedDocument();
    campaignImage(document).src = 'https://images.example.test/new-photo.png';
    expect(() => withBlackFridayOverlay(document, originalUrl, derivedUrl)).toThrow('CAMPAIGN_PHOTO_CHANGED');
    document.blocks.push({ type: 'image', src: originalUrl });
    expect(() => campaignImage(document)).toThrow('EXACTLY_ONE');
  });
});

describe('Black Friday update-only content release', () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture() {
    const templates = [1, 2, 3, 4, 5].map(circle => ({ id: 'template-' + circle, familyId: BLACK_FRIDAY_FAMILY,
      senderKey: 'INFO', campaignCircle: circle, revision: circle + 4, purpose: null, archivedAt: null,
      document: editedDocument(), subject: 'Asunto manual ' + circle, preheader: 'Preheader manual', signatureMode: 'default' }));
    const plan = { originalUrl, templates: templates.map(t => ({ id: t.id, revision: t.revision, documentHash: documentHash(t.document) })) };
    const draft = { id: BLACK_FRIDAY_DRAFT, familyId: BLACK_FRIDAY_FAMILY, mailbox: { address: 'info@cronox.es' }, userId: 1, status: 'DRAFT', campaigns: [], sends: [] };
    const tx: any = { $executeRaw: jest.fn(), $queryRaw: jest.fn().mockResolvedValue(['unchanged']),
      managedEmailTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
      mailboxDraft: { findUniqueOrThrow: jest.fn().mockResolvedValue(draft) },
      emailTemplateVersion: { count: jest.fn().mockResolvedValue(0) } };
    return { db: { $transaction: (callback: any) => callback(tx) }, tx, plan, templates, draft };
  }
  it('saves existing five IDs with their current revisions/copy and never publishes', async () => {
    const { db, plan, templates } = fixture();
    const save = jest.spyOn(ManagedMailService.prototype, 'save').mockResolvedValue({} as any);
    const publish = jest.spyOn(ManagedMailService.prototype, 'action').mockRejectedValue(Error('FORBIDDEN'));
    const result = await updateBlackFridayOverlay(db, plan, derivedUrl, true);
    expect(save).toHaveBeenCalledTimes(5);
    save.mock.calls.forEach((args, index) => {
      expect(args[3]).toBe(templates[index].id);
      expect(args[1]).toMatchObject({ subject: templates[index].subject, revision: templates[index].revision, signatureMode: 'default' });
    });
    expect(publish).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'DRAFT', publishedVersions: 0, campaigns: 0, sends: 0 });
  });
  it('stops on newer saved edits and on queued/published campaigns', async () => {
    const f = fixture();
    f.templates[0].revision++;
    const save = jest.spyOn(ManagedMailService.prototype, 'save').mockResolvedValue({} as any);
    await expect(updateBlackFridayOverlay(f.db, f.plan, derivedUrl, true)).rejects.toThrow('REPLAN');
    expect(save).not.toHaveBeenCalled();
    f.templates[0].revision--;
    f.tx.emailTemplateVersion.count.mockResolvedValue(1);
    await expect(updateBlackFridayOverlay(f.db, f.plan, derivedUrl, true)).rejects.toThrow('UNPUBLISHED');
    f.tx.emailTemplateVersion.count.mockResolvedValue(0);
    f.draft.status = 'QUEUED';
    await expect(updateBlackFridayOverlay(f.db, f.plan, derivedUrl, true)).rejects.toThrow('UNSCHEDULED');
  });
  it('repeat runs preserve later edits without saving again', async () => {
    const f = fixture();
    f.templates.forEach(t => { t.document = withBlackFridayOverlay(t.document, originalUrl, derivedUrl); t.revision++; t.document.blocks[4].text = 'Otra edición posterior'; });
    const save = jest.spyOn(ManagedMailService.prototype, 'save').mockRejectedValue(Error('FORBIDDEN'));
    await updateBlackFridayOverlay(f.db, f.plan, derivedUrl, true);
    expect(save).not.toHaveBeenCalled();
  });
});
