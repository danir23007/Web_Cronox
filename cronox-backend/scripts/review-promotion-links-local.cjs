'use strict';
// Historical correspondence is supplied by an operator, never inferred from dates.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const promotionSelect = { id: true, userId: true, upgradeRequestId: true, status: true, requestedAt: true, promoteAt: true, createdAt: true, updatedAt: true };
const reviewSelect = { id: true, userId: true, fromCircle: true, toCircle: true, requestNumber: true, status: true, createdAt: true, updatedAt: true, approvedAt: true, processedAt: true, autoProcessAt: true };

async function serializable(db, operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: 'Serializable' }); }
    catch (error) {
      const retryable = error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code));
      if (attempt >= 3 || !retryable) throw error;
    }
  }
}

async function assertLocalDatabase(db) {
  const [target] = await db.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS host`;
  if (!['127.0.0.1', '::1'].includes(target.host)) throw Error('LOCAL_DATABASE_REQUIRED');
  return target.name;
}

async function inspectPromotionLinks(db) {
  const database = await assertLocalDatabase(db);
  const promotions = await db.circlePromotionRequest.findMany({ where: { upgradeRequestId: null }, select: promotionSelect, orderBy: { id: 'asc' } });
  const candidates = [];
  for (const promotion of promotions) {
    const reviews = await db.circleUpgradeRequest.findMany({ where: { userId: promotion.userId, fromCircle: 2, toCircle: 3 }, select: reviewSelect, orderBy: { requestNumber: 'asc' } });
    candidates.push({ promotion, expectedPromotionHash: digest(promotion), reviews: reviews.map(review => ({ review, expectedReviewHash: digest(review) })),
      decision: 'REVIEW_REQUIRED: same user and dates do not prove the current cycle; supply independent evidence and an explicit mapping' });
  }
  return { database, mode: 'dry-run', candidates };
}

async function reconcilePromotionLinks(db, mappings, { apply = false, actorId } = {}) {
  const database = await assertLocalDatabase(db);
  if (!Array.isArray(mappings)) throw Error('MAPPINGS_ARRAY_REQUIRED');
  const results = [];
  for (const mapping of mappings) {
    const { promotionId, upgradeRequestId, expectedPromotionHash, expectedReviewHash, evidenceRef } = mapping;
    if (!Number.isSafeInteger(promotionId) || promotionId < 1 || typeof upgradeRequestId !== 'string' || !upgradeRequestId ||
        !/^[a-f0-9]{64}$/.test(expectedPromotionHash) || !/^[a-f0-9]{64}$/.test(expectedReviewHash) ||
        typeof evidenceRef !== 'string' || evidenceRef.trim().length < 8 || evidenceRef.length > 500) throw Error('EXPLICIT_MAPPING_AND_EVIDENCE_REQUIRED');
    const mappingHash = digest({ promotionId, upgradeRequestId, expectedPromotionHash, expectedReviewHash, evidenceRef });
    const requestKey = 'circle-link:' + mappingHash;
    results.push(await serializable(db, async tx => {
      if (apply) {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (actor?.role !== 'SUPERADMIN') throw Error('SUPERADMIN_ACTOR_REQUIRED');
      }
      let promotion = await tx.circlePromotionRequest.findUnique({ where: { id: promotionId }, select: promotionSelect });
      if (!promotion) throw Error('PROMOTION_NOT_FOUND');
      if (apply) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${promotion.userId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "CirclePromotionRequest" WHERE id=${promotionId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "CircleUpgradeRequest" WHERE id=${upgradeRequestId} FOR UPDATE`;
        promotion = await tx.circlePromotionRequest.findUnique({ where: { id: promotionId }, select: promotionSelect });
      }
      const replay = await tx.auditLog.findUnique({ where: { requestKey } });
      if (replay) {
        if (replay.actionType !== 'circle.promotion.link.repair' || replay.targetId !== String(promotionId) ||
            (apply && replay.actorId !== actorId) || replay.metadata?.mappingHash !== mappingHash) throw Error('REPAIR_RECEIPT_MISMATCH');
        // A later legitimate cycle may have replaced the current link. Do not undo it.
        return { promotionId, upgradeRequestId, changed: false, decision: 'already-applied' };
      }
      const review = await tx.circleUpgradeRequest.findUnique({ where: { id: upgradeRequestId }, select: reviewSelect });
      if (!promotion || !review || promotion.upgradeRequestId !== null || digest(promotion) !== expectedPromotionHash || digest(review) !== expectedReviewHash) throw Error('REPAIR_SNAPSHOT_CHANGED');
      if (review.userId !== promotion.userId || review.fromCircle !== 2 || review.toCircle !== 3 ||
          !['pending', 'completed'].includes(promotion.status) || !['PENDING', 'EXPIRED'].includes(review.status)) throw Error('REPAIR_MAPPING_INCOMPATIBLE');
      const linkedElsewhere = await tx.circlePromotionRequest.findUnique({ where: { upgradeRequestId }, select: { id: true } });
      if (linkedElsewhere) throw Error('REVIEW_ALREADY_LINKED');
      const decision = promotion.status === 'completed' ? 'link-and-complete-review' : 'link-current-pending-cycle';
      if (!apply) return { promotionId, upgradeRequestId, changed: false, decision, requiresIndependentEvidence: true };
      await tx.circlePromotionRequest.update({ where: { id: promotionId }, data: { upgradeRequestId } });
      if (promotion.status === 'completed') {
        // Historical effective time is unknown. Preserve approvedAt, including null.
        await tx.circleUpgradeRequest.update({ where: { id: upgradeRequestId }, data: { status: 'APPROVED', processedAt: new Date() } });
      }
      await tx.auditLog.create({ data: { requestKey, actorId, action: 'circle.promotion.link.repair', actionType: 'circle.promotion.link.repair',
        targetType: 'circlePromotionRequest', targetId: String(promotionId),
        metadata: { mappingHash, upgradeRequestId, expectedPromotionHash, expectedReviewHash, evidenceRef, decision, historicalApprovedAtPreserved: true } } });
      return { promotionId, upgradeRequestId, changed: true, decision };
    }));
  }
  return { database, mode: apply ? 'apply' : 'dry-run', results };
}

async function main() {
  Object.assign(process.env, require('./start-local.cjs').loadLocalEnvironment());
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const args = process.argv.slice(2), value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  try {
    const input = value('--mapping'), apply = args.includes('--apply');
    if (apply && !input) throw Error('APPLY_REQUIRES_EXPLICIT_MAPPING');
    const report = input ? await reconcilePromotionLinks(db, JSON.parse(fs.readFileSync(path.resolve(input), 'utf8').replace(/^\uFEFF/, '')),
      { apply, actorId: Number(value('--actor')) }) : await inspectPromotionLinks(db);
    const json = JSON.stringify(report, null, 2);
    if (value('--output')) fs.writeFileSync(path.resolve(value('--output')), json + '\n', { mode: 0o600 });
    console.log(json);
  } finally { await db.$disconnect(); }
}
module.exports = { inspectPromotionLinks, reconcilePromotionLinks, digest };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
