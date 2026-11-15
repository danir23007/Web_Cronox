import { headerHash, headerInventoryHash, HeaderInventory } from './mail-header-rollout';
import { mailCircleNumber } from './mail-circle-folders';
import { PASSWORD_RESET_COPY, PASSWORD_RESET_TEXT, passwordResetDocument } from './password-reset-design';

/** One purpose only: shared transport type PASSWORD_RESET also serves purchase
 * setup mails, which must retain their own designs and copy. */
export function approvedPasswordReset<T extends Record<string, any>>(template: T) {
  if (template.senderKey !== 'NOREPLY' || template.purpose !== 'PASSWORD_RESET') throw Error('PASSWORD_RESET_ONLY');
  return { ...template, subject: PASSWORD_RESET_COPY.subject, preheader: PASSWORD_RESET_COPY.preheader,
    document: passwordResetDocument(), textOverride: PASSWORD_RESET_TEXT };
}

export function planPasswordReset(inventory: HeaderInventory) {
  const cards = inventory.templates.filter(t => t.senderKey === 'NOREPLY' && t.purpose === 'PASSWORD_RESET' && !t.archivedAt);
  const circles = cards.map(t => mailCircleNumber(inventory.folders.find(f => f.id === t.folderId && f.senderKey === 'NOREPLY')?.name || ''));
  if (cards.length !== 5 || circles.some(c => !c) || new Set(circles).size !== 5) throw Error('FIVE_EXISTING_RESET_CIRCLES_REQUIRED');
  const entries = cards.map((original, index) => ({ id: original.id, circle: circles[index]!, original,
    draft: approvedPasswordReset(original), publications: inventory.publications.filter(p =>
      inventory.versions.find(v => v.id === p.versionId)?.templateId === original.id).map(p => {
        const version = inventory.versions.find(v => v.id === p.versionId)!;
        if (p.senderKey !== 'NOREPLY' || p.purpose.replace(/:CIRCLE_[1-5]$/, '') !== 'PASSWORD_RESET' || version.snapshot.id !== original.id) throw Error('RESET_PUBLICATION_IDENTITY_MISMATCH');
        const slot = p.purpose.match(/:CIRCLE_([1-5])$/);
        const bound = version.snapshot.publicationCircle ?? version.snapshot.campaignCircle ??
          mailCircleNumber(inventory.folders.find(f => f.id === version.snapshot.folderId && f.senderKey === 'NOREPLY')?.name || '');
        if (bound !== circles[index] || slot && Number(slot[1]) !== bound) throw Error('RESET_PUBLICATION_CIRCLE_MISMATCH');
        return { senderKey: p.senderKey, purpose: p.purpose, versionId: p.versionId,
          snapshot: approvedPasswordReset(version.snapshot) };
      }) }));
  return { stateHash: headerInventoryHash(inventory), entries };
}

/** Caller locks mail records in a serializable transaction. Never publishes a
 * draft: an existing pointer is advanced from its own previous snapshot. */
export async function applyPasswordReset(tx: any, inventory: HeaderInventory, expectedHash: string,
  render: (template: any) => Promise<{ html: string; text: string }>) {
  const plan = planPasswordReset(inventory);
  if (plan.stateHash !== expectedHash) throw Error('MAIL_STATE_CHANGED_SINCE_REVIEW');
  const result: Array<Record<string, any>> = [];
  for (const entry of plan.entries) {
    const rendered = await render(entry.draft);
    const saved = await tx.managedEmailTemplate.updateMany({ where: { id: entry.id, revision: entry.original.revision }, data: {
      subject: entry.draft.subject, preheader: entry.draft.preheader, document: entry.draft.document,
      textOverride: entry.draft.textOverride, html: rendered.html, text: rendered.text, revision: { increment: 1 },
    } });
    if (saved.count !== 1) throw Error('RESET_DRAFT_CHANGED');
    const publications: Array<Record<string, any>> = [];
    for (const publication of entry.publications) {
      const active = await render(publication.snapshot);
      const version = await tx.emailTemplateVersion.create({ data: { templateId: entry.id,
        snapshot: JSON.parse(JSON.stringify({ ...publication.snapshot, html: active.html, text: active.text })) } });
      const updated = await tx.emailPublication.updateMany({ where: { senderKey: publication.senderKey, purpose: publication.purpose,
        versionId: publication.versionId }, data: { versionId: version.id } });
      if (updated.count !== 1) throw Error('RESET_PUBLICATION_CHANGED');
      publications.push({ slot: publication.purpose, oldVersionId: publication.versionId, versionId: version.id });
    }
    await tx.auditLog.create({ data: { action: 'EMAIL_PASSWORD_RESET_DESIGN_UPDATE', actionType: 'EMAIL_PASSWORD_RESET_DESIGN_UPDATE', targetType: 'EMAIL_TEMPLATE', targetId: entry.id } });
    result.push({ id: entry.id, circle: entry.circle, revision: entry.original.revision + 1, publications,
      source: publications.length ? 'published' : 'spanish-fallback', documentHash: headerHash(entry.draft.document) });
  }
  return result;
}
