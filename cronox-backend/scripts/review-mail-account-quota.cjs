'use strict';
// Called only by review-mailbox.cjs with its isolated loopback PostgreSQL.
module.exports = async ({ db, backend, pass }) => {
  const assert = require('node:assert/strict'), path = require('node:path');
  assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
  const { reserveAccountQuota, recipientUnits, quotaWaiting } = require(path.join(backend,'dist/email/mail-account-quota'));
  const { MailTransportFactory } = require(path.join(backend,'dist/email/mail-transport.factory'));
  const { decrypt } = require(path.join(backend,'dist/mailbox/mailbox-security'));
  const changes = { SMTP_INFO_USER:'quota-info@example.test', SMTP_INFO_DAILY_LIMIT:'3', SMTP_INFO_HOURLY_LIMIT:'0',
    SMTP_ORDERS_USER:'quota-orders@example.test', SMTP_ORDERS_DAILY_LIMIT:'1', SMTP_ORDERS_HOURLY_LIMIT:'0',
    MAILBOX_MAX_RECIPIENTS:'100', EMAIL_SMTP_PAUSED:'false' };
  const prior = Object.fromEntries(Object.keys(changes).map(k => [k,process.env[k]]));
  Object.assign(process.env,changes);
  try {
    assert.equal(recipientUnits({to:'a@example.test', cc:'b@example.test,a@example.test', bcc:'c@example.test'}).units,3);
    assert.throws(() => recipientUnits({to:Array.from({length:101},(_,i)=>`r${i}@example.test`)}),/EMAIL_RECIPIENT_LIMIT/);
    const results = await Promise.allSettled(Array.from({length:12},(_,i)=>db.$transaction(tx =>
      reserveAccountQuota(tx,changes.SMTP_INFO_USER,['AUTO:','MANUAL:','CAMPAIGN:'][i%3]+'quota-test-'+i,1),{timeout:20000})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
    assert(results.filter(r=>r.status==='rejected').every(r=>quotaWaiting(r.reason)));
    assert.equal(await db.mailAccountQuota.count({where:{account:changes.SMTP_INFO_USER}}),3);
    pass('One atomic rolling SMTP account budget shared across concurrent automatic, manual and campaign claims');
    const rows = await db.mailAccountQuota.findMany({where:{account:changes.SMTP_INFO_USER}});
    await db.$transaction(tx=>reserveAccountQuota(tx,changes.SMTP_INFO_USER,rows[0].id,1));
    assert.equal(await db.mailAccountQuota.count({where:{account:changes.SMTP_INFO_USER}}),3);
    await db.$transaction(tx=>reserveAccountQuota(tx,changes.SMTP_ORDERS_USER,'AUTO:quota-independent',1));
    await assert.rejects(db.$transaction(tx=>reserveAccountQuota(tx,changes.SMTP_ORDERS_USER,'MANUAL:quota-other',1)),quotaWaiting);
    await db.mailAccountQuota.updateMany({where:{account:changes.SMTP_INFO_USER},data:{reservedAt:new Date(Date.now()-86400001)}});
    await db.$transaction(tx=>reserveAccountQuota(tx,changes.SMTP_INFO_USER,'AUTO:quota-expired',3));
    pass('Accounts are independent, reservations idempotent, recipient units conserved, and capacity expires after 24 hours');
    const factory = new MailTransportFactory(db);
    factory.getFrom = () => 'quota-orders@example.test';
    let sends = 0;
    factory.getTransport = () => ({ sendMail:async()=>{sends++;return {messageId:'local-quota-accepted',accepted:['buyer@example.test']};} });
    const queued = await factory.sendMail('ORDERS',{to:'buyer@example.test',subject:'Synthetic order',text:'private synthetic body'},'ORDER_CONFIRMATION');
    assert.equal(queued.queued,true); assert.equal(sends,0);
    let job = await db.emailDelivery.findUniqueOrThrow({where:{id:queued.messageId}});
    assert.equal(job.status,'WAITING_QUOTA'); assert(!job.pendingPayload.includes('private synthetic body'));
    assert(JSON.parse(decrypt(job.pendingPayload,job.id+':queued-email')).raw);
    await db.mailAccountQuota.updateMany({where:{account:changes.SMTP_ORDERS_USER},data:{reservedAt:new Date(Date.now()-86400001)}});
    await db.emailDelivery.update({where:{id:job.id},data:{readyAt:new Date(0)}});
    await Promise.all([factory.tickDeferred(),factory.tickDeferred()]); await factory.tickDeferred();
    job = await db.emailDelivery.findUniqueOrThrow({where:{id:job.id}});
    assert.equal(sends,1); assert.equal(job.status,'SMTP_ACCEPTED'); assert.equal(job.pendingPayload,null);
    assert.equal(await db.mailAccountQuota.count({where:{id:'AUTO:'+job.id}}),1);
    pass('Orders wait in an encrypted durable outbox and resume exactly once without falsely recording SMTP acceptance');
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL ROLE anon`;
      await tx.$queryRaw`SELECT * FROM "MailAccountQuota"`;
    }), /permission denied/);
    pass('The shared quota ledger is inaccessible to public roles');
  } finally {
    for (const [k,v] of Object.entries(prior)) { if(v===undefined)delete process.env[k]; else process.env[k]=v; }
  }
};
