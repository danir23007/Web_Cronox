/* Runs ONLY inside review-permanent-history.cjs's freshly created, loopback PostgreSQL. */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async ({ db, app, request, sql, historyMigration, customer, customerToken }) => {
  const { VisitorHistoryService } = require('../dist/analytics/visitor-history.service');
  const { madridDate } = require('../dist/admin/finance/financial-calculations');
  const visits = app.get(VisitorHistoryService), today = madridDate(new Date());
  const consent = { version:'2', analytics:true };
  const cookie = `cronox_csrf_token=local-finance-review-csrf-token-0000; cronox_cookie_consent=${encodeURIComponent(JSON.stringify(consent))}`;
  const client = { cookies:{ cronox_cookie_consent:JSON.stringify(consent) }, user:{ id:customer.id } };
  const guest = { cookies:client.cookies };
  const browserId = randomUUID();
  // Persistent session and multiple devices/parallel tabs converge atomically.
  await Promise.all(Array.from({ length:12 }, () => visits.record(client,'/',randomUUID())));
  assert.equal(await db.dailyVisitor.count({where:{day:new Date(today),category:'authenticated'}}),1);
  await Promise.all(Array.from({ length:12 }, () => visits.record(guest,'/',browserId)));
  await visits.record(client,'/tienda',browserId);
  assert.equal(await db.dailyVisitor.count({where:{day:new Date(today)}}),2);
  assert.equal((await visits.record({cookies:{}},'/',randomUUID())).accepted,false);
  assert.equal(await db.dailyVisitor.count(),2);
  const query = `?from=${today}&to=${today}`;
  const current = await request('/admin/visitors'+query);
  assert.equal(current.status,200); assert.deepEqual(current.body.buckets,[{day:today,authenticated:1,anonymous:1}]);
  assert.equal((await request('/admin/visitors'+query,{},customerToken.accessToken)).status,403);
  assert.equal((await request('/admin/visitors/day?day='+today,{},customerToken.accessToken)).status,403);
  assert.equal((await request('/admin/visitors?from=2026-02-30&to=2026-03-02')).status,400);
  const post = (body, access = customerToken.accessToken, extraCookie = '') => request('/analytics/visits',{method:'POST',body:JSON.stringify(body),headers:{Cookie:cookie+extraCookie,...(!access ? {Authorization:''} : {})}},access);
  const body = { path:'/', browserId, expectedCategory:'authenticated' };
  assert.equal((await post(body)).status,202);
  assert.equal((await post({...body,userId:99999})).status,400);
  assert.equal((await post({...body,expectedCategory:'anonymous'})).status,400);
  assert.equal((await request('/analytics/visits',{method:'POST',body:JSON.stringify(body),headers:{Cookie:cookie,Referer:'http://127.0.0.1:43120/admin.html'}},customerToken.accessToken)).status,400);
  for (const path of ['/admin.html','/admin','/api/products','/health','/?email=secret@example.test']) assert.equal((await post({...body,path})).status,400);
  assert.equal((await post(body,'tampered.jwt')).status,401);
  assert.equal((await post({...body,expectedCategory:'anonymous'},'', '; refresh_token=unresolved')).status,401);
  assert.equal((await post({...body,expectedCategory:'anonymous'},'')).status,202);
  assert.equal((await request('/analytics/visits/session',{headers:{Authorization:'',Cookie:cookie}})).body.category,'anonymous');
  assert.equal((await request('/analytics/visits/session',{},customerToken.accessToken)).body.userId,customer.id);
  // Zero differs from history that did not exist. No imported login/pageview guesses.
  const before = (await request('/admin/visitors?from=2019-01-01&to=2019-01-02')).body;
  assert(before.buckets.every(row => row.authenticated === null && row.anonymous === null));
  const historic = (await request('/admin/finance?from=2019-01-01&to=2019-01-01')).body;
  assert.equal(historic.totals.revenueCents,2000); assert.equal(historic.totals.profitCents,null);
  assert(historic.warnings.some(w => w.includes('fecha de cobro')));
  // Madrid spring/autumn transitions: physical hours 23 and 25, server-day identity stable.
  const special = await db.user.create({data:{email:'erase-history@example.test',name:'Erase me'}});
  const specialClient = {cookies:client.cookies,user:{id:special.id}};
  const instants = ['2026-03-28T23:00:00Z','2026-03-29T21:59:59Z','2026-03-29T22:00:00Z','2026-10-24T22:00:00Z','2026-10-25T22:59:59Z','2026-10-25T23:00:00Z'];
  for (const instant of instants) await visits.record(specialClient,'/',randomUUID(),new Date(instant));
  assert.equal(await db.dailyVisitor.count({where:{userId:special.id}}),4);
  const personal = await db.dailyVisitor.findMany({where:{userId:special.id}});
  await db.user.delete({where:{id:special.id}});
  const anonymousReferences = await db.dailyVisitor.findMany({where:{id:{in:personal.map(row => row.id)}}});
  assert.equal(anonymousReferences.length,4); assert(anonymousReferences.every(row => row.userId === null && row.identity.startsWith('deleted:')));
  for (let i=0;i<30;i++) await visits.record(guest,'/',randomUUID());
  const detail = (await request('/admin/visitors/day?day='+today+'&category=anonymous&page=2')).body;
  assert.equal(detail.pagination.total,31); assert.equal(detail.visitors.length,6);
  assert(detail.visitors.every(row => row.userId === null && row.name === null && row.email === null));
  assert.equal((await request('/admin/visitors/day?day='+today+'&search=customer-finance')).body.pagination.total,1);
  // Archive facts are append-only and migration backfill is idempotent.
  const counts = await Promise.all([db.financeArchive.count(),db.financeArchiveRevision.count(),db.financeEventArchive.count(),db.financeStockArchive.count()]);
  const started = await db.visitorHistoryConfig.findUnique({where:{id:1}});
  sql(historyMigration);
  assert.deepEqual(await Promise.all([db.financeArchive.count(),db.financeArchiveRevision.count(),db.financeEventArchive.count(),db.financeStockArchive.count()]),counts);
  assert.deepEqual(await db.visitorHistoryConfig.findUnique({where:{id:1}}),started);
  for (const table of ['DailyVisitor','FinanceArchive','FinanceArchiveRevision','FinanceEventArchive','FinanceStockArchive','VisitorHistoryConfig']) {
    await assert.rejects(db.$executeRawUnsafe(`TRUNCATE "${table}"`),/Permanent history/);
    for (const role of ['anon','authenticated']) {
      const [access] = await db.$queryRawUnsafe(`SELECT has_table_privilege($1,$2,'SELECT') AS allowed`,role,`"${table}"`);
      assert.equal(access.allowed,false);
    }
  }
  await assert.rejects(db.dailyVisitor.deleteMany(),/Permanent history/);
  await assert.rejects(db.financeArchiveRevision.updateMany({data:{snapshot:{tampered:true}}}),/Permanent history/);
  const economicsBefore = (await request('/admin/finance?from=2026-01-01&to=2026-12-31')).body;
  // Standard void adds a dated refund and separate stock fact, original sale survives.
  const fixture = await db.order.findFirst({where:{items:{some:{product:{slug:'finance-local-30'}}}}});
  await db.orderItemFinancial.deleteMany({where:{item:{orderId:fixture.id}}});
  await db.orderItem.deleteMany({where:{orderId:fixture.id}});
  await db.order.delete({where:{id:fixture.id}});
  const product = await db.product.findUnique({where:{slug:'finance-local-30'}});
  await db.productVariant.deleteMany({where:{productId:product.id}});
  await db.productCost.delete({where:{productId:product.id}});
  await db.product.delete({where:{id:product.id}});
  await db.stripeWebhookEvent.deleteMany({where:{status:'PROCESSED'}});
  await db.stockMovement.deleteMany({where:{reason:{in:['refund','manual_sale_void']}}});
  const economicsAfter = (await request('/admin/finance?from=2026-01-01&to=2026-12-31')).body;
  assert.deepEqual(economicsAfter,economicsBefore);
  // An archived original is still paid evidence even if a legacy status changes later.
  await db.order.update({where:{id:9000},data:{status:'CANCELLED'}});
  assert.deepEqual((await request('/admin/finance?from=2019-01-01&to=2019-01-01')).body.totals,historic.totals);
  // The existing correction flow adds a void + restock, preserving the original revision.
  const manualFixture = await db.order.findFirst({where:{source:'IN_PERSON_ADMIN',status:'PAID'}});
  const original = await db.financeArchiveRevision.findFirst({where:{orderId:manualFixture.id},orderBy:{revision:'asc'}});
  const revisions = await db.financeArchiveRevision.count({where:{orderId:manualFixture.id}});
  const { AdminManualPurchasesService } = require('../dist/admin/manual-purchases/admin-manual-purchases.service');
  const manual = app.get(AdminManualPurchasesService);
  await manual.void(manualFixture.id,manualFixture.recordedById,'Prueba aislada de corrección');
  const corrected = (await request('/admin/finance?from=2026-01-01&to=2026-12-31')).body.totals;
  assert.equal(corrected.revenueCents,economicsBefore.totals.revenueCents-10500);
  assert.equal(corrected.costCents,economicsBefore.totals.costCents-3600);
  assert.equal(await db.financeArchiveRevision.count({where:{orderId:manualFixture.id}}),revisions+1);
  assert.deepEqual((await db.financeArchiveRevision.findFirst({where:{orderId:manualFixture.id},orderBy:{revision:'asc'}})).snapshot,original.snapshot);
  await manual.void(manualFixture.id,manualFixture.recordedById,'Reintento');
  assert.deepEqual((await request('/admin/finance?from=2026-01-01&to=2026-12-31')).body.totals,corrected);
  console.log('PASS: visitor concurrency/daily/account/browser/consent/session security; Madrid DST; pagination/search; account anonymization; legacy finance backfill/replay; immutable protected history after source deletion.');
};
