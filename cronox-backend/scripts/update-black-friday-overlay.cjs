'use strict';
// Explicit content operation. No Nest bootstrap, workers, SMTP, migrations or startup hooks.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { composeBlackFridayOverlay } = require('./compose-black-friday-overlay.cjs');
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const composition = 'static-zero-black-no-panel-v2';
async function main() {
  if (!process.argv.includes('--production')) throw Error('EXPLICIT_PRODUCTION_TARGET_REQUIRED');
  const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const database = new URL(config.DATABASE_URL);
  if (!database.hostname.endsWith('.supabase.com') || !decodeURIComponent(database.username).includes('frqlgocxnyppzdgxxjuq')) throw Error('UNEXPECTED_PRODUCTION_PROJECT');
  Object.assign(process.env, config, { NODE_ENV: 'production', FRONTEND_URL: 'https://cronox.es', API_PUBLIC_URL: 'https://cronox.es',
    EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false' });
  const outputIndex = process.argv.indexOf('--workdir');
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw Error('EXPLICIT_PRIVATE_WORKDIR_REQUIRED');
  const workdir = path.resolve(process.argv[outputIndex + 1]);
  const planPath = path.join(workdir, 'plan.private.json');
  const { PrismaClient } = require('@prisma/client');
  const { campaignImage, imageDestination, documentHash, updateBlackFridayOverlay, OVERLAY_ALT } = require('../dist/email/managed/black-friday-overlay');
  const { BLACK_FRIDAY_FAMILY } = require('../dist/email/managed/black-friday-draft');
  const db = new PrismaClient();
  try {
    if (process.argv.includes('--prepare')) {
      if (fs.existsSync(planPath)) throw Error('PLAN_EXISTS_USE_A_NEW_WORKDIR_TO_REPLAN');
      const templates = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return tx.managedEmailTemplate.findMany({ where: { familyId: BLACK_FRIDAY_FAMILY }, orderBy: { campaignCircle: 'asc' } });
      });
      if (JSON.stringify(templates.map(t => t.campaignCircle)) !== '[1,2,3,4,5]') throw Error('FIVE_EXISTING_VERSIONS_REQUIRED');
      const originals = [...new Set(templates.map(t => campaignImage(t.document).src).filter(Boolean))];
      if (originals.length !== 1) throw Error('ONE_SAVED_CAMPAIGN_PHOTO_REQUIRED');
      const currentUrl = originals[0];
      let sourceAsset = await db.emailAsset.findFirst({ where: { senderKey: 'INFO', url: currentUrl } });
      let originalHash;
      // Always reconstruct from the intact original, never from a raster that
      // already contains a previous counter. Resolve its recorded provenance.
      if (sourceAsset?.id.startsWith('bf-overlay:')) {
        const audit = await db.auditLog.findFirst({ where: { targetId: sourceAsset.id, action: 'EMAIL_ASSET_UPLOAD' }, orderBy: { createdAt: 'desc' } });
        if (!audit?.metadata?.sourceAssetId || !audit.metadata.originalHash) throw Error('ORIGINAL_IMAGE_PROVENANCE_REQUIRED');
        originalHash = audit.metadata.originalHash;
        sourceAsset = await db.emailAsset.findFirst({ where: { id: audit.metadata.sourceAssetId, senderKey: 'INFO' } });
      }
      if (sourceAsset?.id.startsWith('bf-overlay:')) throw Error('INTACT_ORIGINAL_IMAGE_REQUIRED');
      const originalUrl = sourceAsset?.url;
      if (!sourceAsset || !originalUrl.startsWith(config.SUPABASE_URL + '/storage/v1/object/public/')) throw Error('EXISTING_INFO_ASSET_REQUIRED');
      const destinations = [...new Set(templates.map(t => imageDestination(t.document)))];
      for (const destination of destinations) {
        const response = await fetch(destination, { method: 'HEAD', redirect: 'error' });
        if (response.status !== 200) throw Error('BLACK_FRIDAY_DESTINATION_UNAVAILABLE');
      }
      const response = await fetch(originalUrl, { redirect: 'error' });
      if (!response.ok) throw Error('ORIGINAL_IMAGE_UNAVAILABLE');
      const original = Buffer.from(await response.arrayBuffer());
      if (original.length > 5 * 1024 * 1024) throw Error('ORIGINAL_IMAGE_TOO_LARGE');
      if (originalHash && hash(original) !== originalHash) throw Error('ORIGINAL_IMAGE_BYTES_CHANGED');
      const derived = await composeBlackFridayOverlay(original);
      const plan = { composition, originalUrl, acceptedSourceUrls: [currentUrl], sourceAssetId: sourceAsset.id, originalHash: hash(original), derivedHash: hash(derived.buffer),
        width: derived.width, height: derived.height, bounds: derived.bounds, destinations,
        templates: templates.map(t => ({ id: t.id, revision: t.revision, documentHash: documentHash(t.document) })) };
      fs.mkdirSync(workdir, { recursive: true });
      fs.writeFileSync(path.join(workdir, 'snapshot.private.json'), JSON.stringify(templates, null, 2), { flag: 'wx' });
      fs.writeFileSync(path.join(workdir, 'original.png'), original, { flag: 'wx' });
      fs.writeFileSync(path.join(workdir, 'derived.png'), derived.buffer, { flag: 'wx' });
      fs.writeFileSync(path.join(workdir, 'panel.private.svg'), derived.svg, { flag: 'wx' });
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ prepared: true, sourceAssetId: sourceAsset.id, width: derived.width, height: derived.height,
        originalHash: plan.originalHash, derivedHash: plan.derivedHash, sourceCircle: templates.find(t => campaignImage(t.document).src)?.campaignCircle,
        revisions: plan.templates.map(t => t.revision), destinations, productionWrites: false }, null, 2));
      return;
    }
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    if (plan.composition !== composition) throw Error('PREPARE_CURRENT_COMPOSITION_PLAN_REQUIRED');
    const original = fs.readFileSync(path.join(workdir, 'original.png'));
    const buffer = fs.readFileSync(path.join(workdir, 'derived.png'));
    if (hash(original) !== plan.originalHash || hash(buffer) !== plan.derivedHash) throw Error('REVIEWED_IMAGE_BYTES_CHANGED');
    const sourceAsset = await db.emailAsset.findFirst({ where: { id: plan.sourceAssetId, senderKey: 'INFO', url: plan.originalUrl } });
    if (!sourceAsset) throw Error('ORIGINAL_ASSET_CHANGED');
    const assetId = 'bf-overlay:' + plan.derivedHash;
    let asset = await db.emailAsset.findUnique({ where: { id: assetId } });
    if (asset && (asset.senderKey !== 'INFO' || asset.fileSize !== buffer.length)) throw Error('DERIVED_ASSET_CONFLICT');
    const current = await db.managedEmailTemplate.findMany({ where: { familyId: BLACK_FRIDAY_FAMILY } });
    for (const template of current) {
      const expected = plan.templates.find(t => t.id === template.id);
      if (asset && campaignImage(template.document).src === asset.url) continue;
      if (!expected || expected.revision !== template.revision || expected.documentHash !== documentHash(template.document)) throw Error('SAVED_DRAFT_CHANGED_REPLAN_REQUIRED');
    }
    const apply = process.argv.includes('--apply');
    // Validate current draft/publication state before any upload. The original
    // public URL is sufficient for this read-only image patch preflight.
    await updateBlackFridayOverlay(db, plan, asset?.url || plan.originalUrl, false);
    if (!asset && !apply) {
      console.log(JSON.stringify({ ready: true, productionWrites: false, reviewedImageHash: plan.derivedHash, templates: plan.templates.length }));
      return;
    }
    if (!asset) {
      const { SupabaseStorageService } = require('../dist/common/storage/supabase-storage.service');
      const storage = new SupabaseStorageService();
      asset = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assetId}))`;
        const existing = await tx.emailAsset.findUnique({ where: { id: assetId } });
        if (existing) return existing;
        const uploaded = await storage.uploadEmailImage({ buffer, mimetype: 'image/png' }, 'INFO');
        const result = await tx.emailAsset.create({ data: { ...uploaded, id: assetId, senderKey: 'INFO', name: 'Black Friday · contador estático · original ' + sourceAsset.id, alt: OVERLAY_ALT } });
        await tx.auditLog.create({ data: { action: 'EMAIL_ASSET_UPLOAD', actionType: 'EMAIL_ASSET_UPLOAD', targetType: 'EMAIL_ASSET', targetId: result.id,
          metadata: { sourceAssetId: sourceAsset.id, originalHash: plan.originalHash, derivedHash: plan.derivedHash, composition, originalPreserved: true } } });
        return result;
      }, { timeout: 60000 });
    }
    const publicResponse = await fetch(asset.url, { redirect: 'error' });
    if (!publicResponse.ok || hash(Buffer.from(await publicResponse.arrayBuffer())) !== plan.derivedHash) throw Error('PUBLIC_DERIVED_IMAGE_NOT_VERIFIED');
    const result = await updateBlackFridayOverlay(db, plan, asset.url, apply);
    fs.writeFileSync(path.join(workdir, 'result.private.json'), JSON.stringify({ ...result, assetId: asset.id, url: asset.url }, null, 2));
    console.log(JSON.stringify({ ...result, assetId: asset.id, url: asset.url, originalPreserved: true }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message || 'OVERLAY_RELEASE_FAILED'); process.exitCode = 1; });
