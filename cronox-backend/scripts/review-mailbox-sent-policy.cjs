'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
module.exports = async ({ app, db, backend, users, stores, sender, sync, service, smtpMessages, pass, request }) => {
  assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
  const { MockImapStore } = require('../../tests/mailbox/mock-imap.cjs');
  const retention = app.get(require(path.join(backend, 'dist/mailbox/mailbox-retention.service')).MailboxRetentionService);
  const tracking = app.get(require(path.join(backend, 'dist/mailbox/mailbox-tracking.service')).MailboxTrackingService);
  const actor = { id: users.superadmin.id, role: 'SUPERADMIN' }, now = new Date(), cutoff = new Date(now.getTime() - 30 * 86400000);
  const savedEnv = { ...process.env };
  try {
    process.env.MAILBOX_SEND_ENABLED = 'true'; process.env.MAILBOX_WORKER_ENABLED = 'true';
    process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED = 'true';
    process.env.FRONTEND_URL = 'https://cronox.es'; process.env.API_PUBLIC_URL = 'https://cronox.es';
    const seed = await db.mailbox.findFirstOrThrow();
    const makeBox = async (key, address) => {
      process.env['SMTP_' + key + '_USER'] = address;
      const box = await db.mailbox.create({ data: { ...seed, id: randomUUID(), name: 'Same visible label', address, username: address, active: true, leaseToken: null, leaseUntil: null, activatedAt: now } });
      const store = new MockImapStore(); stores.set(box.id, store);
      const folders = {};
      for (const [name, f] of store.folders) folders[name] = await db.mailboxFolder.create({ data: { mailboxId: box.id, path: name, specialUse: f.specialUse, uidValidity: String(f.validity) } });
      return { box, store, folders };
    };
    const no = await makeBox('NOREPLY', 'policy-noreply@example.test');
    const orders = await makeBox('ORDERS', 'policy-orders@example.test');
    const support = await makeBox('SUPPORT', 'policy-support@example.test');
    const info = await makeBox('INFO', 'policy-info@example.test');
    const addMessage = async (fixture, folderName, uid, date, messageId = '<' + randomUUID() + '@example.test>') => {
      const row = fixture.store.message(uid, 'Retained fixture', date); row.envelope.messageId = messageId;
      fixture.store.folders.get(folderName).rows.push(row);
      return db.mailboxMessage.create({ data: { mailboxId: fixture.box.id, folderId: fixture.folders[folderName].id, uidValidity: String(fixture.store.folders.get(folderName).validity), uid, subject: row.envelope.subject, sender: fixture.box.address, recipients: 'target@example.test', envelope: {}, date, size: 100, messageId } });
    };
    const makeDraft = (fixture, data = {}) => db.mailboxDraft.create({ data: { mailboxId: fixture.box.id, userId: actor.id, mode: 'reply', to: 'local-recipient@example.test', subject: 'Policy fixture', text: 'Exclusive content', html: '<p>Exclusive content</p>', ...data } });
    const draft = await makeDraft(support);
    const exclusive = await retention.files.write(Readable.from('exclusive'), 100);
    await db.mailboxFile.create({ data: { ...exclusive, mailboxId: support.box.id, draftId: draft.id, name: 'exclusive.txt', mimeType: 'text/plain' } });
    const received = await addMessage(support, 'INBOX', 1, new Date(now.getTime() - 90 * 86400000));
    const shared = await retention.files.write(Readable.from('shared'), 100);
    await db.mailboxFile.create({ data: { ...shared, mailboxId: support.box.id, draftId: draft.id, name: 'shared.txt', mimeType: 'text/plain' } });
    await db.mailboxMessage.update({ where: { id: received.id }, data: { bodyKey: shared.key } });
    await assert.rejects(() => service.deleteDraft({ id: users.reader.id, role: 'ADMIN' }, draft.id, draft.revision));
    const deleted = await request('/drafts/' + draft.id, 'DELETE', { revision: draft.revision });
    assert.equal(deleted.status, 200);
    await retention.garbage();
    await assert.rejects(() => retention.files.read(exclusive.key));
    assert.equal(await db.mailboxFile.findUnique({ where: { key: shared.key } }), null);
    assert(await db.mailboxMessage.findUnique({ where: { id: received.id } }));
    await retention.files.read(shared.key);
    pass('Draft DELETE verifies permissions and removes only exclusive resources; shared received attachments survive');

    const stale = await makeDraft(support);
    await db.mailboxDraft.update({ where: { id: stale.id }, data: { status: 'SCHEDULED', revision: { increment: 1 } } });
    await assert.rejects(() => service.deleteDraft(actor, stale.id, stale.revision), /CHANGED_OR_QUEUED/);
    const racing = await makeDraft(support);
    const session = await db.authSession.findFirstOrThrow({ where: { userId: actor.id, revokedAt: null } });
    const claims = { sid: session.id, sv: session.sessionVersion };
    const races = await Promise.allSettled([
      service.deleteDraft(actor, racing.id, racing.revision),
      service.enqueue(actor, racing.id, { revision: racing.revision, requestKey: randomUUID() }, claims),
    ]);
    const deletedRace = races[0].status === 'fulfilled';
    const queuedRace = races[1].status === 'fulfilled';
    assert.notEqual(deletedRace, queuedRace);
    const survivingRace = await db.mailboxSend.findFirst({ where: { draftId: racing.id } });
    if (survivingRace) { await db.mailboxSend.update({ where: { id: survivingRace.id }, data: { status: 'FAILED' } }); await db.mailboxDraft.update({ where: { id: racing.id }, data: { status: 'FAILED' } }); }
    pass('Concurrent draft deletion/enqueue has a single winner; scheduled drafts cannot be deleted');

    for (const fixture of [no, orders]) {
      const d = await makeDraft(fixture);
      const attachment = await retention.files.write(Readable.from('synthetic attachment'), 100);
      await db.mailboxFile.create({ data: { ...attachment, mailboxId: fixture.box.id, draftId: d.id, name: 'fixture.txt', mimeType: 'text/plain' } });
      await service.enqueue(actor, d.id, { revision: d.revision, requestKey: randomUUID() }, claims);
      const job = await db.mailboxSend.findFirstOrThrow({ where: { draftId: d.id } }), before = smtpMessages.length;
      await sender.process(job.id);
      const outcome = await db.mailboxSend.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(outcome.status, 'SMTP_ACCEPTED'); assert.equal(outcome.sentCopyStatus, 'NOT_RETAINED');
      assert.equal(smtpMessages.length, before + 1); assert.equal(fixture.store.appends, 0);
      const stored = await db.mailboxDraft.findUniqueOrThrow({ where: { id: d.id } });
      assert.equal(stored.text, ''); assert.equal(stored.html, '');
      assert.equal(await db.mailboxFile.count({ where: { draftId: d.id } }), 0);
      await retention.garbage(); await assert.rejects(() => retention.files.read(attachment.key));
      assert(outcome.messageId && outcome.requestKey && outcome.accepted.length && outcome.completedAt);
      await sender.process(job.id); assert.equal(smtpMessages.length, before + 1);
      await addMessage(fixture, 'Sent', 1, now);
      await addMessage(fixture, 'INBOX', 1, now);
      const sim = await retention.cleanBox(fixture.box.id, true, now); assert.equal(sim.local, 1); assert.equal(sim.provider, 1);
      assert.equal(fixture.store.folders.get('Sent').rows.length, 1);
      await retention.cleanBox(fixture.box.id, false, now);
      await sync.sync(fixture.box.id); await sync.sync(fixture.box.id);
      assert.equal(await db.mailboxMessage.count({ where: { folderId: fixture.folders.Sent.id } }), 0);
      assert.equal(fixture.store.folders.get('INBOX').rows.length, 1);
      assert.equal((await retention.cleanBox(fixture.box.id, false, now)).provider, 0);
    }
    pass('NOREPLY/ORDERS keep minimal accepted/idempotent results, no body or APPEND; cleanup is simulated/idempotent and Sent cannot reimport');

    await addMessage(support, 'Sent', 1, new Date(cutoff.getTime() - 1));
    await addMessage(support, 'Sent', 2, cutoff);
    const fresh = await addMessage(support, 'Sent', 3, new Date(cutoff.getTime() + 1));
    support.store.folders.get('Sent').rows.find(r => r.uid === 3).flags.add('\\Deleted');
    await addMessage(support, 'Drafts', 1, new Date(0));
    const supportDraft = await makeDraft(support);
    const old = await makeDraft(support, { status: 'SMTP_ACCEPTED' });
    await db.mailboxSend.create({ data: { draftId: old.id, draftRevision: 1, userId: actor.id, sessionId: 'fixture', sessionVersion: 1, status: 'SMTP_ACCEPTED', messageId: '<' + randomUUID() + '@example.test>', requestKey: randomUUID(), completedAt: cutoff } });
    assert.equal((await retention.cleanBox(support.box.id, true, now)).provider, 2);
    const imap = support.store.client(); imap.capabilities.delete('UIDPLUS');
    const originalClient = support.store.client; support.store.client = () => imap;
    await assert.rejects(() => retention.cleanBox(support.box.id, false, now), /UIDPLUS/);
    support.store.client = originalClient;
    await retention.cleanBox(support.box.id, false, now);
    assert.deepEqual(support.store.folders.get('Sent').rows.map(r => r.uid), [3]);
    assert(await db.mailboxMessage.findUnique({ where: { id: fresh.id } }));
    assert.equal((await db.mailboxDraft.findUniqueOrThrow({ where: { id: old.id } })).text, '');
    assert.equal((await db.mailboxDraft.findUniqueOrThrow({ where: { id: supportDraft.id } })).text, 'Exclusive content');
    assert.equal(support.store.folders.get('Drafts').rows.length, 1);
    assert.equal(support.store.folders.get('INBOX').rows.length, 1);
    await sync.sync(support.box.id);
    const automatic = await addMessage(support, 'Sent', 4, new Date(cutoff.getTime() - 1000));
    process.env.MAILBOX_SENT_RETENTION_ENABLED = 'true';
    for (let i = 0; i <= await db.mailbox.count({ where: { active: true } }); i++) await retention.tick();
    assert.equal(await db.mailboxMessage.findUnique({ where: { id: automatic.id } }), null);
    assert(!support.store.folders.get('Sent').rows.some(r => r.uid === 4));
    delete process.env.MAILBOX_SENT_RETENTION_ENABLED;
    pass('Support exact 30-day cutoff, received/draft preservation, UIDPLUS guard and unrelated Deleted sent message preserved');

    const historyDraft = await makeDraft(info, { mode: 'campaign', status: 'COMPLETED', campaignName: 'Immutable historical fixture' });
    const content = { subject: 'Historical subject', html: '<p>Original</p>', text: 'Original', circle: 1, templateId: 'historical', templateRevision: 1 };
    const campaign = await db.mailboxCampaign.create({ data: { draftId: historyDraft.id, draftRevision: 1, requestKey: randomUUID(), scheduledAt: now, status: 'COMPLETED', snapshot: { modelVersion: 2, versions: [content], count: 2 }, deliveries: { create: [1, 2].map(i => ({ email: 'historic-' + i + '@example.test', circleLevel: 1, content, status: i === 1 ? 'SMTP_ACCEPTED' : 'FAILED', messageId: '<' + randomUUID() + '@example.test>' })) } }, include: { deliveries: true } });
    await addMessage(info, 'Sent', 1, now, campaign.deliveries[0].messageId);
    const unassociated = await addMessage(info, 'Sent', 2, now);
    const simulated = await retention.cleanBox(info.box.id, true, now);
    assert(simulated.unresolved.some(v => v.includes(unassociated.id))); assert.equal(simulated.local, 1);
    assert.equal(await db.mailboxCampaignVersion.count({ where: { campaignId: campaign.id } }), 0);
    const clean = await retention.cleanBox(info.box.id, false, now);
    assert(clean.unresolved.length); assert.equal(await db.mailboxCampaignVersion.count({ where: { campaignId: campaign.id } }), 1);
    const normalized = await db.mailboxCampaignDelivery.findMany({ where: { campaignId: campaign.id } });
    assert(normalized.every(d => d.versionId && d.content === null)); assert.equal(normalized[0].versionId, normalized[1].versionId);
    assert(await db.mailboxMessage.findUnique({ where: { id: unassociated.id } }));
    assert.equal((await tracking.metrics(campaign.id)).effectiveness, null);
    await retention.cleanBox(info.box.id, false, now);
    assert.equal(await db.mailboxCampaignVersion.count({ where: { campaignId: campaign.id } }), 1);
    pass('Info cleanup freezes unique historical content/results before deletion, leaves unassociated copies intact and creates no retrospective tracking');

    const tracked = await db.mailboxCampaign.create({ data: { draftId: historyDraft.id, draftRevision: 2, requestKey: randomUUID(), scheduledAt: now, status: 'COMPLETED', snapshot: { modelVersion: 2 }, deliveries: { create: Array.from({ length: 103 }, (_, i) => ({ email: 'metric-' + i + '@example.test', messageId: '<' + randomUUID() + '@example.test>', status: i < 100 ? 'SMTP_ACCEPTED' : i === 100 ? 'FAILED' : i === 101 ? 'UNKNOWN' : 'EXCLUDED', trackingToken: randomUUID() })) } }, include: { deliveries: true } });
    const trackedVersion = await db.mailboxCampaignVersion.create({ data: { campaignId: tracked.id, fingerprint: 'fixture', content } });
    await db.mailboxCampaignDelivery.updateMany({ where: { campaignId: tracked.id }, data: { versionId: trackedVersion.id } });
    const req = { cookies: { cronox_cookie_consent: JSON.stringify({ version: '2', analytics: true }) }, get: name => ({ referer: 'https://cronox.es/tienda?size=M', 'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-origin' })[name] };
    const arrivalToken = delivery => new URL(tracking.redirect(tracking.link('https://cronox.es/tienda?size=M#details', delivery.trackingToken).split('/api/mailbox-access/')[1])).searchParams.get('cx_campaign');
    const token = arrivalToken(tracked.deliveries[0]);
    assert.equal((await tracking.metrics(tracked.id)).attributed, 0);
    assert.equal((await tracking.arrive(req, token, '/tienda')).attributed, false, 'No immediate scanner request');
    assert.equal((await tracking.arrive({ ...req, cookies: {} }, token, '/tienda', Date.now() + 3000)).attributed, false);
    assert.equal((await tracking.arrive({ ...req, user: { role: 'ADMIN' } }, token, '/tienda', Date.now() + 3000)).attributed, false);
    assert.equal((await tracking.arrive({ ...req, get: name => name === 'user-agent' ? 'Security crawler' : req.get(name) }, token, '/tienda', Date.now() + 3000)).attributed, false);
    for (const delivery of tracked.deliveries.slice(0, 50)) {
      const token = arrivalToken(delivery); await tracking.arrive(req, token, '/tienda', Date.now() + 3000);
      await tracking.arrive(req, token, '/tienda', Date.now() + 3000);
    }
    for (const delivery of tracked.deliveries.slice(100)) await tracking.arrive(req, arrivalToken(delivery), '/tienda', Date.now() + 3000);
    const metrics = await tracking.metrics(tracked.id);
    assert.equal(metrics.accepted, 100); assert.equal(metrics.attributed, 50); assert.equal(metrics.effectiveness, 50); assert.equal(metrics.failed, 1); assert.equal(metrics.uncertain, 1);
    await db.mailboxCampaignDelivery.update({ where: { id: tracked.deliveries[0].id }, data: { bouncedAt: now } });
    assert.equal((await tracking.metrics(tracked.id)).bounced, 1);
    const zeroDraft = await makeDraft(info, { mode: 'campaign', status: 'COMPLETED', campaignName: 'Zero denominator fixture' });
    const zero = await db.mailboxCampaign.create({ data: { draftId: zeroDraft.id, draftRevision: 1, requestKey: randomUUID(), scheduledAt: now, status: 'FAILED', snapshot: {}, deliveries: { create: { email: 'zero@example.test', messageId: '<' + randomUUID() + '@example.test>', status: 'FAILED', trackingToken: randomUUID() } } } });
    assert.equal((await tracking.metrics(zero.id)).effectiveness, null);
    for (const theme of ['light', 'dark']) for (const mode of ['desktop', 'mobile']) await makeDraft(support, { subject: 'Browser delete ' + theme + ' ' + mode });
    pass('Redirect alone never counts; consent, delay, internal access exclusion, unique accepted recipients and 50/100 effectiveness verified');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
};
