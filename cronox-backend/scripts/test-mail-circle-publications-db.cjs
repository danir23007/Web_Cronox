// Uses the existing five local cards. All publications, edits and audit rows
// live in one transaction which is rolled back, including on assertion failure.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const backend = path.resolve(__dirname, '..');
require('reflect-metadata');
const env = require('./start-local.cjs').loadLocalEnvironment();
assert.ok(['localhost', '127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname), 'LOCAL_DATABASE_REQUIRED');
Object.assign(process.env, env);
const { PrismaClient } = require('@prisma/client'), db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
const { EmailService } = require('../dist/email/email.service');
const { MAIL_PURPOSES } = require('../dist/email/managed/mail-catalog');
const { mailPreviewData } = require('../dist/email/managed/welcome-design');
const { mailPublicationKey } = require('../dist/email/managed/mail-publication-scope');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function state() { return hash(await Promise.all([
  db.managedEmailTemplate.findMany({ orderBy: { id: 'asc' } }), db.emailTemplateVersion.findMany({ orderBy: { id: 'asc' } }),
  db.emailPublication.findMany({ orderBy: [{ senderKey: 'asc' }, { purpose: 'asc' }] }), db.auditLog.count(),
])); }
(async () => { let report; const before = await state(); try {
  await db.$transaction(async tx => {
    const proxy = new Proxy(tx, { get: (target, key) => key === '$transaction' ? operation => Array.isArray(operation) ? Promise.all(operation) : operation(proxy) : target[key] });
    const messages = [], transport = { sendMail: async (sender, message) => { messages.push(message); return { accepted: [message.to], messageId: 'memory-only' }; } };
    const service = new ManagedMailService(proxy, transport), email = new EmailService(transport, service), cases = [];
    async function counters() {
      for (const account of await service.accounts()) {
        const list = await service.list(account.key, { page: 1, limit: 5000, sort: 'name' });
        assert.equal(account.counts.templates, list.total); assert.equal(account.counts.published, list.items.filter(r => r.published).length);
        assert.equal(account.counts.drafts + account.counts.published, list.total);
        for (const folder of await service.folders(account.key)) {
          const list = await service.list(account.key, { page: 1, limit: 5000, sort: 'name', folderId: folder.id });
          assert.equal(folder.counts.templates, list.total); assert.equal(folder.counts.published, list.items.filter(r => r.published).length);
          assert.equal(folder.counts.drafts + folder.counts.published, list.total);
        }
      }
    }
    const rows = await tx.managedEmailTemplate.findMany({ where: { archivedAt: null }, include: { folder: true }, orderBy: { id: 'asc' } });
    const groups = MAIL_PURPOSES.map(p => ({ ...p, rows: rows.filter(r => r.senderKey === p.senderKey && r.purpose === p.key && /^Círculo [1-5]$/.test(r.folder.name)).sort((a,b) => a.folder.name.localeCompare(b.folder.name)) })).filter(p => p.rows.length === 5);
    assert.ok(groups.some(g => g.key === 'SUPPORT_TICKET_RECEIVED')); assert.ok(groups.some(g => g.key === 'ORDER_CONFIRMATION'));
    const oldSupport = groups.find(g => g.key === 'SUPPORT_TICKET_RECEIVED').rows[4];
    const legacyVersion = await tx.emailTemplateVersion.create({data:{templateId:oldSupport.id,snapshot:JSON.parse(JSON.stringify(oldSupport))}});
    await tx.emailPublication.upsert({where:{senderKey_purpose:{senderKey:'SUPPORT',purpose:'SUPPORT_TICKET_RECEIVED'}},update:{versionId:legacyVersion.id},create:{senderKey:'SUPPORT',purpose:'SUPPORT_TICKET_RECEIVED',versionId:legacyVersion.id}});
    assert.ok(await service.published('SUPPORT','SUPPORT_TICKET_RECEIVED',{...mailPreviewData('SUPPORT_TICKET_RECEIVED'),circleLevel:5}));
    assert.equal(await service.published('SUPPORT','SUPPORT_TICKET_RECEIVED',{...mailPreviewData('SUPPORT_TICKET_RECEIVED'),circleLevel:1}),null);
    for (const group of groups) for (const green of group.key === 'SUPPORT_TICKET_RECEIVED' ? [false, true] : [false]) {
      const ids = group.rows.map(r => r.id);
      for (let i = 0; i < 5; i++) await tx.managedEmailTemplate.update({ where: { id: ids[i] }, data: { subject: `FIXTURE ${group.key} circle ${i + 1}`, ...(green ? { visualClassification: 'FOR_ALL' } : {}) } });
      const current = id => service.template(group.senderKey, id);
      const action = async (id, action) => service.action(group.senderKey, id, { action, confirmed: true, revision: (await current(id)).revision });
      for (const id of ids) await action(id, 'publish');
      let list = await service.list(group.senderKey, { page: 1, limit: 5000, sort: 'name' });
      assert.equal(list.items.filter(r => ids.includes(r.id) && r.published).length, 5);
      const active = async circle => tx.emailPublication.findUnique({ where: { senderKey_purpose: { senderKey: group.senderKey, purpose: mailPublicationKey(group.key, circle) } }, include: { version: true } });
      const initial = await Promise.all([1,2,3,4,5].map(active));
      if (group.key === 'SUPPORT_TICKET_RECEIVED') {
        assert.equal(await tx.emailPublication.findUnique({where:{senderKey_purpose:{senderKey:'SUPPORT',purpose:group.key}}}),null);
        assert.ok(await tx.emailTemplateVersion.findUnique({where:{id:legacyVersion.id}}));
      }
      await action(ids[2], 'publish'); await action(ids[1], 'unpublish');
      for (const circle of [1,4,5]) assert.equal((await active(circle)).versionId, initial[circle-1].versionId);
      assert.notEqual((await active(3)).versionId, initial[2].versionId); assert.equal(await active(2), null);
      const draft = await current(ids[0]);
      await service.save(group.senderKey, { ...draft, subject: 'UNPUBLISHED EDIT', visualClassification: undefined, signatureId: draft.signatureId ?? undefined }, undefined, draft.id);
      const data = { ...mailPreviewData(group.key), customerEmail: 'lucia@example.test' };
      for (let circle = 1; circle <= 5; circle++) {
        const rendered = await service.published(group.senderKey, group.key, { ...data, circleLevel: circle });
        if (circle === 2) assert.equal(rendered, null); else { assert.ok(rendered); assert.equal(rendered.subject, `FIXTURE ${group.key} circle ${circle}`); }
        if (['SUPPORT_TICKET_RECEIVED', 'ORDER_CONFIRMATION'].includes(group.key)) {
          await email.send({ type: group.type, to: 'lucia@example.test', subject: 'FIRST-PARTY FALLBACK', templateData: { ...data, circleLevel: circle } });
          assert.equal(messages.at(-1).subject, circle === 2 ? 'FIRST-PARTY FALLBACK' : `FIXTURE ${group.key} circle ${circle}`);
        }
      }
      for (const circleLevel of [undefined, null, 0, 6, '3']) assert.equal(await service.published(group.senderKey, group.key, { ...data, circleLevel }), null);
      await counters();
      cases.push({ senderKey: group.senderKey, purpose: group.key, green, ids, simultaneousPublications: 5, afterUnpublish: 4, unchangedCircles: [1,4,5], draftUsesPreviousVersion: true, noCrossCircleFallback: true });
    }
    report = { cases, memoryMessages: messages.length, legacyCompatibilityVerified: true, countersMatch: true, realEmails: 0, rolledBack: true };
    throw Error('ROLLBACK_VERIFIED_TEST');
  }, { timeout: 120000 });
} catch (error) { if (error.message !== 'ROLLBACK_VERIFIED_TEST') throw error; }
assert.equal(await state(), before, 'LOCAL_ROWS_VERSIONS_PUBLICATIONS_OR_AUDIT_CHANGED');
const folder=path.join(backend,'../output/playwright/mail-circle-publications');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'integration-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({ purposes: report.cases.length, memoryMessages: report.memoryMessages, countersMatch: true, rolledBack: true, realEmails: 0 },null,2));
})().catch(error => { console.error(error); process.exitCode=1; }).finally(()=>db.$disconnect());
