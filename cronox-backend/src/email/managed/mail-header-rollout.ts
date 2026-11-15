import { createHash } from 'node:crypto';
import { APPROVED_WELCOME_TEMPLATE_ID, withMailLogoHeader } from './mail-logo-header';
import { mailCircleNumber } from './mail-circle-folders';

type Row = Record<string, any>;
export type HeaderInventory = { templates: Row[]; versions: Row[]; publications: Row[]; folders: Row[]; signatures?: Row[] };
const canonical = (value: any): any => value?.toJSON ? canonical(value.toJSON()) : Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const headerHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const headerInventoryHash = (inventory: HeaderInventory) => headerHash({ templates: inventory.templates, versions: inventory.versions, publications: inventory.publications, folders: inventory.folders, signatures: inventory.signatures });

export function planMailHeaders(inventory: HeaderInventory) {
  const approved = inventory.templates.find(t => t.id === APPROVED_WELCOME_TEMPLATE_ID);
  if (!approved || approved.senderKey !== 'NOREPLY') throw Error('APPROVED_WELCOME_IDENTITY_REQUIRED');
  const entries: Row[] = [];
  for (const template of inventory.templates) {
    if (template.id === APPROVED_WELCOME_TEMPLATE_ID || template.purpose === 'ORDER_CONFIRMATION') continue;
    const folder = inventory.folders.find(f => f.id === template.folderId && f.senderKey === template.senderKey);
    const circle = folder && mailCircleNumber(folder.name);
    if (!circle) continue;
    const publications = inventory.publications.filter(p => inventory.versions.find(v => v.id === p.versionId)?.templateId === template.id);
    const eligible = ['NOREPLY', 'ORDERS'].includes(template.senderKey) ||
      template.senderKey === 'SUPPORT' && template.purpose === 'SUPPORT_TICKET_RECEIVED' && publications.length > 0;
    if (!eligible) continue;
    const document = withMailLogoHeader(template.document, template.id);
    const active = publications.map(publication => {
      const version = inventory.versions.find(v => v.id === publication.versionId)!;
      const snapshot = version.snapshot;
      if (publication.senderKey !== template.senderKey || snapshot.senderKey !== template.senderKey || snapshot.id !== template.id || publication.purpose.replace(/:CIRCLE_[1-5]$/, '') !== snapshot.purpose) throw Error('PUBLICATION_IDENTITY_MISMATCH');
      // Build from the immutable publication, NEVER from the editable draft.
      const updated = { ...snapshot, document: withMailLogoHeader(snapshot.document, template.id) };
      return { senderKey: publication.senderKey, purpose: publication.purpose, oldVersionId: version.id,
        beforeHash: headerHash(version), snapshot: updated, changed: headerHash(updated.document) !== headerHash(snapshot.document) };
    });
    entries.push({ id: template.id, senderKey: template.senderKey, circle, name: template.name,
      archived: !!template.archivedAt, beforeHash: headerHash(template), document,
      changed: headerHash(document) !== headerHash(template.document), publications: active });
  }
  return { stateHash: headerInventoryHash(inventory), excludedId: APPROVED_WELCOME_TEMPLATE_ID, entries };
}

/** Caller owns a serializable transaction and locks inventory rows before use.
 * No send/publish action is invoked: existing slots alone receive new snapshots. */
export async function applyMailHeaders(tx: any, inventory: HeaderInventory, expectedHash: string,
  render: (senderKey: string, snapshot: any) => Promise<{ html: string }>) {
  const plan = planMailHeaders(inventory);
  if (plan.stateHash !== expectedHash) throw Error('MAIL_INVENTORY_CHANGED_SINCE_REVIEW');
  const result: Row[] = [];
  for (const entry of plan.entries) {
    if (entry.changed) {
      const original = inventory.templates.find(t => t.id === entry.id)!;
      const rendered = await render(entry.senderKey, { ...original, document: entry.document });
      const claimed = await tx.managedEmailTemplate.updateMany({ where: { id: entry.id, revision: original.revision },
        data: { document: entry.document, html: rendered.html, revision: { increment: 1 } } });
      if (claimed.count !== 1) throw Error('MAIL_DRAFT_CHANGED_DURING_UPDATE');
    }
    const updated: Row[] = [];
    for (const publication of entry.publications.filter((p: Row) => p.changed)) {
      const rendered = await render(entry.senderKey, publication.snapshot);
      const version = await tx.emailTemplateVersion.create({ data: { templateId: entry.id,
        snapshot: JSON.parse(JSON.stringify({ ...publication.snapshot, html: rendered.html })) } });
      const claimed = await tx.emailPublication.updateMany({ where: { senderKey: publication.senderKey,
        purpose: publication.purpose, versionId: publication.oldVersionId }, data: { versionId: version.id } });
      if (claimed.count !== 1) throw Error('MAIL_PUBLICATION_CHANGED_DURING_UPDATE');
      updated.push({ slot: publication.purpose, oldVersionId: publication.oldVersionId, versionId: version.id });
    }
    if (entry.changed || updated.length) await tx.auditLog.create({ data: { action: 'EMAIL_HEADER_UPDATE', actionType: 'EMAIL_HEADER_UPDATE', targetType: 'EMAIL_TEMPLATE', targetId: entry.id } });
    result.push({ id: entry.id, senderKey: entry.senderKey, circle: entry.circle, name: entry.name,
      archived: entry.archived, draftUpdated: entry.changed, publications: updated });
  }
  return { updated: result, excludedId: plan.excludedId };
}
