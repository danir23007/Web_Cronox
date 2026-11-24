import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { ManagedMailService } from './managed-mail.service';
import { CART_COPY, cartAbandonedDocument } from './cart-abandoned-design';
import { mailCircleNumber } from './mail-circle-folders';
import type { MailDocument } from './mail-renderer';
import { EmailSenderKey } from '../email.types';

/** Content release only. Uses the existing save/CAS/audit/version/publication
 * mechanism, atomically, and cannot instantiate or call SMTP or a worker. */
export async function publishCartMailDesign(db: any, apply = false) {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cart-mail-design-release-v2'))`;
    const footprint = async () => tx.$queryRaw`
      SELECT 'drafts' AS kind, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY t.id),'')) AS digest
      FROM "ManagedEmailTemplate" t WHERE t.purpose IS DISTINCT FROM 'CART_ABANDONED'
      UNION ALL SELECT 'versions', md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY v.id),''))
      FROM "EmailTemplateVersion" v JOIN "ManagedEmailTemplate" t ON t.id=v."templateId" WHERE t.purpose IS DISTINCT FROM 'CART_ABANDONED'
      UNION ALL SELECT 'publications', md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p.purpose,p."senderKey"),''))
      FROM "EmailPublication" p WHERE p.purpose NOT LIKE 'CART_ABANDONED%' ORDER BY kind`;
    const before = await footprint();
    const templates = await tx.managedEmailTemplate.findMany({ where: { senderKey: 'NOREPLY', purpose: 'CART_ABANDONED', archivedAt: null }, include: { folder: true }, orderBy: { id: 'asc' } });
    const circles = templates.map((t: any) => mailCircleNumber(t.folder.name)).sort();
    if (JSON.stringify(circles) !== '[1,2,3,4,5]') throw Error('CART_RELEASE_EXPECTS_EXACTLY_ONE_TEMPLATE_PER_CIRCLE');
    let scoped: any;
    scoped = new Proxy(tx, { get(target, property) {
      if (property === '$transaction') return (callback: any) => typeof callback === 'function' ? callback(scoped) : Promise.all(callback);
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const noSmtp = new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN_IN_CONTENT_RELEASE'); } });
    const service = new ManagedMailService(scoped, noSmtp as any);
    const result: Array<{ circle: number; templateId: string; previousRevision: number; changed: boolean; versionId?: string; published: boolean }> = [];
    for (const current of templates) {
      const circle = mailCircleNumber(current.folder.name)!;
      const document = cartAbandonedDocument(current.document as MailDocument);
      const publication = await tx.emailPublication.findUnique({ where: { senderKey_purpose: { senderKey: 'NOREPLY', purpose: `CART_ABANDONED:CIRCLE_${circle}` } }, include: { version: true } });
      const snapshot = publication?.version.snapshot as any;
      const matches = (value: any) => value && value.subject === CART_COPY.subject && value.preheader === CART_COPY.preheader && value.name === CART_COPY.name && value.signatureMode === 'none' && !value.textOverride && isDeepStrictEqual(value.document, document);
      let versionId = publication?.versionId;
      if (apply && (!matches(current) || !matches(snapshot))) {
        const saved = await service.save(EmailSenderKey.NOREPLY, { ...current, visualClassification: current.visualClassification ?? undefined, name: CART_COPY.name, subject: CART_COPY.subject, preheader: CART_COPY.preheader, document, signatureMode: 'none', textOverride: null } as any, undefined, current.id);
        await service.action(EmailSenderKey.NOREPLY, current.id, { action: 'publish', revision: saved.revision, confirmed: true });
        versionId = (await tx.emailPublication.findUniqueOrThrow({ where: { senderKey_purpose: { senderKey: 'NOREPLY', purpose: `CART_ABANDONED:CIRCLE_${circle}` } } })).versionId;
      }
      result.push({ circle, templateId: current.id, previousRevision: current.revision, changed: !matches(current) || !matches(snapshot), versionId, published: Boolean(versionId) });
    }
    if (JSON.stringify(before) !== JSON.stringify(await footprint())) throw Error('NON_CART_MAIL_CONTENT_CHANGED');
    return { applied: apply, otherPurposesUnchanged: true, smtp: 'forbidden', templates: result.sort((a, b) => a.circle - b.circle) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 });
}
