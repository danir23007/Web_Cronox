import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { BLACK_FRIDAY_FAMILY, BLACK_FRIDAY_DRAFT } from './black-friday-draft';
import { MAIL_LOGO_BLACK, MAIL_LOGO_WHITE } from './mail-logo-header';
import { MailBlock, MailDocument } from './mail-renderer';
import { ManagedMailService } from './managed-mail.service';
import { EmailSenderKey } from '../email.types';

export const OVERLAY_ALT = 'Fotografía de campaña CRONOX. Black Friday ya ha comenzado: 00 días, 00 horas, 00 minutos y 00 segundos.';
export const documentHash = (document: unknown) => createHash('sha256').update(JSON.stringify(document)).digest('hex');

export function campaignImage(document: MailDocument) {
  if (document.format || !Array.isArray(document.blocks)) throw Error('NATIVE_CAMPAIGN_DOCUMENT_REQUIRED');
  const images: MailBlock[] = [];
  const visit = (blocks: MailBlock[]) => blocks.forEach(block => {
    if (block.type === 'image' && ![MAIL_LOGO_BLACK, MAIL_LOGO_WHITE].includes(block.src || '')) images.push(block);
    block.columns?.forEach(visit);
  });
  visit(document.blocks);
  if (images.length !== 1) throw Error('EXACTLY_ONE_CAMPAIGN_IMAGE_REQUIRED');
  return images[0];
}

export function imageDestination(document: MailDocument) {
  const buttons: MailBlock[] = [];
  const visit = (blocks: MailBlock[]) => blocks.forEach(block => {
    if (block.type === 'button' && block.text === 'DESCUBRIR LOS PRECIOS') buttons.push(block);
    block.columns?.forEach(visit);
  });
  visit(document.blocks);
  if (buttons.length !== 1 || !buttons[0].url) throw Error('EXISTING_BLACK_FRIDAY_BUTTON_REQUIRED');
  const destination = new URL(buttons[0].url);
  if (destination.origin !== 'https://cronox.es' || destination.pathname !== '/') throw Error('REVIEW_EXISTING_BLACK_FRIDAY_DESTINATION');
  return buttons[0].url;
}

/** Image-only correction. Preserve vertical spacing; restore edge-to-edge width. */
export function withBlackFridayOverlay(current: MailDocument, originalUrl: string, derivedUrl: string, acceptedSourceUrls: string[] = []): MailDocument {
  const copy = structuredClone(current);
  const image = campaignImage(copy);
  if (image.src && image.src !== originalUrl && image.src !== derivedUrl && !acceptedSourceUrls.includes(image.src)) throw Error('CAMPAIGN_PHOTO_CHANGED');
  image.src = derivedUrl;
  image.url = imageDestination(current);
  image.alt = OVERLAY_ALT;
  image.paddingTop = image.paddingTop ?? image.padding ?? 12;
  image.paddingBottom = image.paddingBottom ?? image.padding ?? 12;
  image.padding = 0;
  image.paddingLeft = 0;
  image.paddingRight = 0;
  image.width = 640;
  return copy;
}

export type OverlayPlan = {
  originalUrl: string;
  acceptedSourceUrls?: string[];
  templates: Array<{ id: string; revision: number; documentHash: string }>;
};

/** Patch existing saved production drafts only. No creation/publication/queue APIs. */
export async function updateBlackFridayOverlay(db: any, plan: OverlayPlan, derivedUrl: string, apply = false) {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('black-friday-numbers-overlay-2026'))`;
    const templates = await tx.managedEmailTemplate.findMany({ where: { familyId: BLACK_FRIDAY_FAMILY }, orderBy: { campaignCircle: 'asc' } });
    if (JSON.stringify(templates.map((t: any) => t.campaignCircle)) !== '[1,2,3,4,5]' || plan.templates.length !== 5) throw Error('FIVE_EXISTING_VERSIONS_REQUIRED');
    if (templates.some((t: any) => t.senderKey !== 'INFO' || t.archivedAt || t.purpose !== null)) throw Error('EXISTING_INFO_CAMPAIGN_REQUIRED');
    const draft = await tx.mailboxDraft.findUniqueOrThrow({ where: { id: BLACK_FRIDAY_DRAFT }, include: { mailbox: true, campaigns: true, sends: true } });
    if (draft.familyId !== BLACK_FRIDAY_FAMILY || draft.mailbox.address !== 'info@cronox.es' || draft.status !== 'DRAFT' || draft.campaigns.length || draft.sends.length)
      throw Error('UNSCHEDULED_INFO_DRAFT_REQUIRED');
    if (await tx.emailTemplateVersion.count({ where: { template: { familyId: BLACK_FRIDAY_FAMILY } } })) throw Error('CAMPAIGN_MUST_REMAIN_UNPUBLISHED');
    const footprint = () => tx.$queryRaw`
      SELECT 'templates' AS kind, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t.id),'')) AS digest FROM "ManagedEmailTemplate" t WHERE t."familyId" IS DISTINCT FROM ${BLACK_FRIDAY_FAMILY}
      UNION ALL SELECT 'versions', md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY v.id),'')) FROM "EmailTemplateVersion" v
      UNION ALL SELECT 'publications', md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p."senderKey",p.purpose),'')) FROM "EmailPublication" p
      UNION ALL SELECT 'drafts', md5(coalesce(string_agg(to_jsonb(d)::text,'' ORDER BY d.id),'')) FROM "MailboxDraft" d
      UNION ALL SELECT 'families', md5(coalesce(string_agg(to_jsonb(f)::text,'' ORDER BY f.id),'')) FROM "CampaignTemplateFamily" f
      ORDER BY kind`;
    const before = await footprint();
    const scoped: any = new Proxy(tx, { get(target, property) {
      if (property === '$transaction') return (callback: any) => callback(scoped);
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const forbidden = new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN_IN_OVERLAY_RELEASE'); } });
    const service = new ManagedMailService(scoped, forbidden as any);
    const result: Array<{ id: string; circle: number; changed: boolean }> = [];
    for (const current of templates) {
      const document = withBlackFridayOverlay(current.document, plan.originalUrl, derivedUrl, plan.acceptedSourceUrls);
      const changed = !isDeepStrictEqual(document, current.document);
      const expected = plan.templates.find(t => t.id === current.id);
      // An already applied patch is a no-op, including after later manual edits.
      if (changed && (!expected || expected.revision !== current.revision || expected.documentHash !== documentHash(current.document))) throw Error('SAVED_DRAFT_CHANGED_REPLAN_REQUIRED');
      if (changed && apply) await service.save(EmailSenderKey.INFO, { ...current, document,
        visualClassification: current.visualClassification ?? undefined, signatureId: current.signatureId ?? undefined,
      }, draft.userId, current.id);
      result.push({ id: current.id, circle: current.campaignCircle, changed });
    }
    if (JSON.stringify(before) !== JSON.stringify(await footprint())) throw Error('UNRELATED_MAIL_CHANGED');
    return { applied: apply, templates: result, status: 'DRAFT', publishedVersions: 0, campaigns: 0, sends: 0, unrelatedMailUnchanged: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 });
}
