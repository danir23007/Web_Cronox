import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeEmail } from '../common/email';
import { preferenceKey } from './newsletter-preference';

export const OWNER_ACTIVATION_REASON = 'activación administrativa solicitada por el propietario';
export type ActivationMember = { id: number; identityUid: string; emailKey: string; createdAt: string; initiallySubscribed: boolean };
export type OwnerActivationPlan = { version: 1; runId: string; capturedAt: string; cohort: ActivationMember[] };
export const activationPlanHash = (plan: OwnerActivationPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const canonical = (value: any): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);

export function validateActivationPlan(plan: OwnerActivationPlan) {
  if (plan.version !== 1 || !/^owner-nl-[a-z0-9-]{10,70}$/.test(plan.runId) || !Number.isFinite(Date.parse(plan.capturedAt)) || !plan.cohort.length || plan.cohort.length > 10000 || new Set(plan.cohort.map(m => m.id)).size !== plan.cohort.length || new Set(plan.cohort.map(m => m.emailKey)).size !== plan.cohort.length)
    throw Error('OWNER_NEWSLETTER_INVALID_PLAN');
  for (const m of plan.cohort) if (!Number.isSafeInteger(m.id) || m.id < 1 || !m.identityUid || !/^[a-f0-9]{64}$/.test(m.emailKey) || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.initiallySubscribed !== 'boolean') throw Error('OWNER_NEWSLETTER_INVALID_MEMBER');
}

export async function liveNewsletterCampaigns(tx: Prisma.TransactionClient) {
  return tx.mailboxCampaign.findMany({ where: { cancelledAt: null, status: { in: ['SCHEDULED', 'PROCESSING'] } }, select: { id: true, status: true, scheduledAt: true } });
}

export async function captureActivationState(tx: Prisma.TransactionClient, ids: number[]) {
  return {
    users: await tx.user.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, identityUid: true, email: true, createdAt: true, updatedAt: true, role: true, circleLevel: true, accountState: true, newsletterSubscribed: true } }),
    subscriptions: await tx.newsletterSubscription.findMany({ orderBy: { id: 'asc' } }),
    suppressions: await tx.mailboxSuppression.findMany({ orderBy: { email: 'asc' } }),
    preferences: await tx.auditLog.findMany({ where: { targetType: 'NEWSLETTER_PREFERENCE' }, orderBy: { id: 'asc' } }),
    liveCampaigns: await liveNewsletterCampaigns(tx),
  };
}

/** Explicit operator operation only: never invoked by startup, HTTP or workers. */
export async function activateOwnerNewsletter(db: PrismaClient, plan: OwnerActivationPlan, backup: (state: unknown) => void) {
  validateActivationPlan(plan);
  const planHash = activationPlanHash(plan);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${plan.runId}))`;
    const completed = await tx.auditLog.findUnique({ where: { requestKey: plan.runId } });
    if (completed) {
      if ((completed.metadata as any)?.planHash !== planHash) throw Error('OWNER_NEWSLETTER_PLAN_CHANGED');
      // A repeated operation must not reactivate a later withdrawal.
      return { alreadyApplied: true, updated: 0, original: completed.metadata };
    }
    // Prevent an enqueue from appearing between the check and commit. No campaign
    // rows are changed; confirmation after commit still checks its audience hash.
    await tx.$executeRaw`LOCK TABLE "MailboxCampaign" IN SHARE MODE`;
    if ((await liveNewsletterCampaigns(tx)).length) throw Error('OWNER_NEWSLETTER_SCHEDULE_REVIEW_REQUIRED');
    const before = await captureActivationState(tx, plan.cohort.map(m => m.id));
    const ordered = [...before.users].sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email)));
    for (const user of ordered) {
      const email = normalizeEmail(user.email);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    }
    const locked = await captureActivationState(tx, plan.cohort.map(m => m.id));
    // Synchronous durable backup must succeed before the first data write.
    backup({ plan, planHash, at: new Date(), state: locked });
    const changed: number[] = [], skipped: Record<string, number> = {};
    const skip = (reason: string) => { skipped[reason] = (skipped[reason] || 0) + 1; };
    for (const member of plan.cohort) {
      const user = locked.users.find(u => u.id === member.id);
      if (!user || user.identityUid !== member.identityUid || user.createdAt.toISOString() !== member.createdAt || preferenceKey(user.email) !== member.emailKey) { skip('IDENTITY_CHANGED_OR_MISSING'); continue; }
      if (member.initiallySubscribed) { skip('INITIALLY_SUBSCRIBED'); continue; }
      if (user.newsletterSubscribed) { skip('ALREADY_SUBSCRIBED'); continue; }
      const email = normalizeEmail(user.email);
      const suppression = locked.suppressions.find(s => normalizeEmail(s.email) === email);
      if (suppression && suppression.reason !== 'CONFIRMED_HARD_BOUNCE') { skip('SUPPRESSION_' + suppression.reason); continue; }
      if (locked.preferences.some(p => p.targetId === member.emailKey && (p.metadata as any)?.subscribed === false && (p.metadata as any)?.explicit !== false)) { skip('EXPLICIT_REJECTION'); continue; }
      const matches = locked.subscriptions.filter(s => normalizeEmail(s.email) === email);
      if (matches.length > 1) throw Error('OWNER_NEWSLETTER_LINK_CONFLICT');
      const subscription = matches.length ? await tx.newsletterSubscription.findUnique({ where: { id: matches[0].id } }) : null;
      if (subscription?.userId && subscription.userId !== user.id) throw Error('OWNER_NEWSLETTER_LINK_CONFLICT');
      // Administrative eligibility is not user acceptance: subscribedAt and all
      // verification/welcome history remain intact; new linked rows have null consent.
      const linked = subscription
        ? subscription.userId === user.id ? subscription : await tx.newsletterSubscription.update({ where: { id: subscription.id }, data: { userId: user.id } })
        : await tx.newsletterSubscription.create({ data: { email, userId: user.id } });
      const updated = await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
      await tx.auditLog.create({ data: { requestKey: `${plan.runId}:${user.id}`, action: 'OWNER_NEWSLETTER_ACTIVATED', targetType: 'NEWSLETTER_ADMIN_ACTIVATION', targetId: String(user.id), reason: OWNER_ACTIVATION_REASON,
        metadata: json({ runId: plan.runId, planHash, capturedAt: plan.capturedAt, administrative: true, userConsent: false, previous: { newsletterSubscribed: false, userUpdatedAt: user.updatedAt, subscription }, after: { newsletterSubscribed: true, userUpdatedAt: updated.updatedAt, subscription: linked } }) } });
      changed.push(user.id);
    }
    await tx.auditLog.create({ data: { requestKey: plan.runId, action: 'OWNER_NEWSLETTER_ACTIVATION_BATCH', targetType: 'NEWSLETTER_ADMIN_BATCH', targetId: plan.runId, reason: OWNER_ACTIVATION_REASON,
      metadata: json({ planHash, capturedAt: plan.capturedAt, cohort: plan.cohort, changed, updated: changed.length, skipped, administrative: true, userConsent: false }) } });
    return { alreadyApplied: false, updated: changed.length, skipped, cohortSize: plan.cohort.length };
  }, { isolationLevel: 'Serializable', timeout: 60000, maxWait: 10000 });
}

/** Optional compensation. Refuse to overwrite any later preference or history. */
export async function rollbackOwnerNewsletter(db: PrismaClient, plan: OwnerActivationPlan) {
  validateActivationPlan(plan);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${plan.runId}))`;
    const batch = await tx.auditLog.findUnique({ where: { requestKey: plan.runId } });
    if (!batch || (batch.metadata as any)?.planHash !== activationPlanHash(plan)) throw Error('OWNER_NEWSLETTER_BATCH_NOT_FOUND');
    const key = `${plan.runId}:rollback`;
    if (await tx.auditLog.findUnique({ where: { requestKey: key } })) return { alreadyRolledBack: true, restored: 0 };
    await tx.$executeRaw`LOCK TABLE "MailboxCampaign" IN SHARE MODE`;
    if ((await liveNewsletterCampaigns(tx)).length) throw Error('OWNER_NEWSLETTER_SCHEDULE_REVIEW_REQUIRED');
    const events = await tx.auditLog.findMany({ where: { action: 'OWNER_NEWSLETTER_ACTIVATED', metadata: { path: ['runId'], equals: plan.runId } }, orderBy: { targetId: 'asc' } });
    for (const event of events) {
      const state: any = event.metadata, member = plan.cohort.find(m => String(m.id) === event.targetId)!;
      const user = await tx.user.findUniqueOrThrow({ where: { id: member.id } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + normalizeEmail(user.email)}))`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: member.id } });
      const subscription = await tx.newsletterSubscription.findUnique({ where: { id: state.after.subscription.id } });
      if (current.identityUid !== member.identityUid || preferenceKey(current.email) !== member.emailKey || !current.newsletterSubscribed || current.updatedAt.toISOString() !== state.after.userUpdatedAt || canonical(json(subscription)) !== canonical(state.after.subscription)) throw Error('OWNER_NEWSLETTER_ROLLBACK_LATER_CHANGE');
      await tx.user.update({ where: { id: member.id }, data: { newsletterSubscribed: state.previous.newsletterSubscribed } });
      if (!state.previous.subscription) await tx.newsletterSubscription.delete({ where: { id: subscription!.id } });
      else if (state.previous.subscription.userId !== subscription!.userId) await tx.newsletterSubscription.update({ where: { id: subscription!.id }, data: { userId: state.previous.subscription.userId } });
    }
    await tx.auditLog.create({ data: { requestKey: key, action: 'OWNER_NEWSLETTER_ACTIVATION_ROLLED_BACK', targetType: 'NEWSLETTER_ADMIN_BATCH', targetId: plan.runId, reason: OWNER_ACTIVATION_REASON, metadata: { restored: events.length, userConsent: false } } });
    return { alreadyRolledBack: false, restored: events.length };
  }, { isolationLevel: 'Serializable', timeout: 60000, maxWait: 10000 });
}
