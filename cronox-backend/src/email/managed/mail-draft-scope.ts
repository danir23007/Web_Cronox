import { Prisma } from '@prisma/client';

export const CANONICAL_MAIL_CIRCLES = [1, 2, 3, 4, 5].map(n => `Círculo ${n}`);
type Identity = { id: string; senderKey: string; purpose: string | null; importKey?: string | null; familyId?: string | null };

/** Import identities include the design suffix, not just the delivery purpose. */
export function draftScope(source: Identity): { kind: 'family' | 'import' | 'explicit' | 'single'; where: Prisma.ManagedEmailTemplateWhereInput } {
  if (source.familyId) return { kind: 'family', where: { familyId: source.familyId } };
  if (!source.importKey) return { kind: 'explicit', where: { familyId: null, importKey: null } };
  const [sender, circle, purpose, ...design] = source.importKey.split(':');
  if (sender !== source.senderKey || !/^[1-5]$/.test(circle) || purpose !== source.purpose)
    return { kind: 'single', where: { id: source.id } };
  const suffix = design.length ? ':' + design.join(':') : '';
  return { kind: 'import', where: { familyId: null, importKey: { in: [1, 2, 3, 4, 5].map(n => `${sender}:${n}:${purpose}${suffix}`) } } };
}

/** Compare the effective document shown by the editor, before deciding what to write. */
type DraftContent = { name: string; folderId: string; subject: string; preheader?: string;
  purpose?: string | null; signatureMode: string; signatureId?: string | null;
  textOverride?: string | null; document: unknown };
export function draftContentMatches(source: DraftContent, input: DraftContent) {
  return input.name.trim() === source.name && input.folderId === source.folderId &&
    input.subject === source.subject && (input.preheader || '') === source.preheader &&
    (input.purpose || null) === source.purpose && input.signatureMode === source.signatureMode &&
    (input.signatureMode === 'selected' ? input.signatureId || null : null) === source.signatureId &&
    (input.textOverride === undefined || input.textOverride === source.textOverride) &&
    JSON.stringify(input.document) === JSON.stringify(source.document);
}
