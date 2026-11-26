import { Prisma } from '@prisma/client';
import { ManagedMailService } from './managed-mail.service';
import { EmailSenderKey } from '../email.types';
import { resolveMailCircle } from './mail-circle-folders';
import { BLACK_FRIDAY_COPY as copy, BLACK_FRIDAY_FAMILY as familyId, BLACK_FRIDAY_DRAFT as draftId, blackFridayDocument } from './black-friday-draft';

/** Explicit, additive content release. Never bootstraps Nest or queues mail.
 * Stable identities and a transaction lock make retries safe; existing edits
 * are never overwritten, even after the campaign has subsequently been used. */
export async function saveBlackFridayDrafts(db: any, apply = false) {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('black-friday-numbers-draft-2026'))`;
    const footprint = () => tx.$queryRaw`
      SELECT 'templates' AS kind, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t.id),'')) AS digest
      FROM "ManagedEmailTemplate" t WHERE t."familyId" IS DISTINCT FROM ${familyId}
      UNION ALL SELECT 'versions', md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY v.id),'')) FROM "EmailTemplateVersion" v
      UNION ALL SELECT 'publications', md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p."senderKey",p.purpose),'')) FROM "EmailPublication" p
      UNION ALL SELECT 'families', md5(coalesce(string_agg(to_jsonb(f)::text,'' ORDER BY f.id),'')) FROM "CampaignTemplateFamily" f WHERE f.id <> ${familyId}
      UNION ALL SELECT 'drafts', md5(coalesce(string_agg(to_jsonb(d)::text,'' ORDER BY d.id),'')) FROM "MailboxDraft" d WHERE d.id <> ${draftId}
      UNION ALL SELECT 'circles', md5(coalesce(string_agg(u.id::text || ':' || coalesce(u."circleLevel"::text,''),',' ORDER BY u.id),'')) FROM "User" u
      ORDER BY kind`;
    const before = await footprint();
    const box = await tx.mailbox.findUnique({ where: { address: 'info@cronox.es' }, select: { id: true, active: true } });
    const sender = await tx.emailSenderProfile.findUnique({ where: { key: 'INFO' } });
    if (!box?.active || !sender) throw Error('EXISTING_INFO_MAILBOX_REQUIRED');
    // Prefer an existing SUPERADMIN campaign owner, otherwise the canonical
    // SUPERADMIN. Draft visibility is scoped to this existing user.
    const prior = await tx.mailboxDraft.findFirst({ where: { mailboxId: box.id, mode: 'campaign' }, orderBy: { updatedAt: 'desc' }, select: { userId: true } });
    const owner = await tx.user.findFirst({ where: { role: 'SUPERADMIN', ...(prior ? { id: prior.userId } : {}) }, orderBy: { id: 'asc' }, select: { id: true } })
      || await tx.user.findFirst({ where: { role: 'SUPERADMIN' }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!owner) throw Error('EXISTING_CAMPAIGN_ADMIN_REQUIRED');
    const folders = await Promise.all([1, 2, 3, 4, 5].map(n => resolveMailCircle(tx, 'INFO', n)));
    const existing = await tx.campaignTemplateFamily.findUnique({ where: { id: familyId }, include: { versions: true } });
    if (existing && existing.eventKind !== 'GENERAL') throw Error('CAMPAIGN_IDENTITY_CONFLICT');
    const scoped: any = new Proxy(tx, { get(target, property) {
      if (property === '$transaction') return (callback: any) => callback(scoped);
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const forbidden = new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN_IN_DRAFT_RELEASE'); } });
    const service = new ManagedMailService(scoped, forbidden as any);
    if (!existing && apply) await tx.campaignTemplateFamily.create({ data: { id: familyId, name: copy.name, eventKind: 'GENERAL' } });
    const templates: Array<{ circle: number; id?: string; created: boolean }> = [];
    for (let n = 1; n <= 5; n++) {
      const current = existing?.versions.find((t: any) => t.campaignCircle === n);
      if (current && (current.senderKey !== 'INFO' || current.archivedAt)) throw Error('CAMPAIGN_VERSION_CONFLICT');
      let id = current?.id;
      if (!current && apply) {
        const saved = await service.save(EmailSenderKey.INFO, { name: copy.name, folderId: folders[n - 1].id, subject: copy.subject,
          preheader: copy.preheader, document: blackFridayDocument(), signatureMode: 'default' } as any, owner.id);
        await service.linkCampaignVersion('INFO', familyId, n, { templateId: saved.id, revision: saved.revision });
        id = saved.id;
      }
      templates.push({ circle: n, id, created: !current && apply });
    }
    let draft = await tx.mailboxDraft.findUnique({ where: { id: draftId } });
    if (draft && (draft.familyId !== familyId || draft.mailboxId !== box.id)) throw Error('DRAFT_IDENTITY_CONFLICT');
    if (!draft && apply) draft = await tx.mailboxDraft.create({ data: {
      id: draftId, mailboxId: box.id, userId: owner.id, mode: 'campaign', familyId,
      campaignName: copy.name, subject: copy.name, circles: [1, 2, 3, 4, 5], status: 'DRAFT',
    } });
    const publishedVersions = await tx.emailTemplateVersion.count({ where: { template: { familyId } } });
    const campaigns = await tx.mailboxCampaign.count({ where: { draftId } });
    const sends = await tx.mailboxSend.count({ where: { draftId } });
    if (JSON.stringify(before) !== JSON.stringify(await footprint())) throw Error('EXISTING_MAIL_OR_CIRCLES_CHANGED');
    return { applied: apply, familyId, draftId: draft?.id, status: draft?.status || 'NOT_CREATED', templates,
      publishedVersions, campaigns, sends, existingContentUnchanged: true, smtp: 'forbidden', ownerId: owner.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 });
}
