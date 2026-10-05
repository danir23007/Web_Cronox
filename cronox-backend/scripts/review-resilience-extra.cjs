'use strict';
// Called only by the disposable PostgreSQL harness; no provider calls.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

if (process.argv.includes('--storage-child')) {
  const { ExpiringThrottlerStorage } = require('../dist/common/guards/expiring-throttler.storage');
  (async () => {
    const storage = new ExpiringThrottlerStorage();
    try {
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await storage.increment('same-operation-and-ip', 60000, 2, 60000, 'default'));
      console.log(JSON.stringify({ blocked: results.map(r => r.isBlocked), hits: results.map(r => r.totalHits) }));
    } finally { storage.onApplicationShutdown(); }
  })().catch(() => { process.exitCode = 1; });
}

exports.review = async ({ db, prisma, app, sample }) => {
  const children = await Promise.all(Array.from({ length: 2 }, () => promisify(execFile)(process.execPath,
    [__filename, '--storage-child'], { windowsHide: true, env: { SystemRoot: process.env.SystemRoot } })));
  const limits = children.map(child => JSON.parse(child.stdout));
  for (const result of limits) assert.deepEqual(result.blocked, [false, false, true]);
  console.log(JSON.stringify({ check: 'Two independent OS processes', limits, sharedBudget: false }));

  // Expire readiness's previous cached result before exhausting its real pool.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const holding = Promise.all([prisma.$queryRaw`SELECT 1 FROM pg_sleep(1.6)`, prisma.$queryRaw`SELECT 1 FROM pg_sleep(1.6)`]);
  await new Promise(resolve => setTimeout(resolve, 150));
  const original = prisma.$queryRaw;
  let probes = 0;
  prisma.$queryRaw = function (...args) { probes++; return original.apply(this, args); };
  try {
    const results = await sample('twelve readiness probes under pool exhaustion', '/api/ready', {}, 12, 12);
    assert(results.every(result => result.status === 503));
    assert.equal(probes, 1, 'Only one SELECT 1 queued for concurrent probes');
    console.log(JSON.stringify({ check: 'Readiness pending-query bound', requests: 12, queryAttempts: probes }));
  } finally { prisma.$queryRaw = original; await holding; }
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await sample('readiness recovered after pool exhaustion', '/api/ready', {}, 1))[0].status, 200);

  const { withExportSqlDeadline } = require('../dist/admin/exports/export-sql-deadline');
  const started = performance.now();
  let status;
  try { await withExportSqlDeadline(prisma, tx => tx.$queryRaw`SELECT 1 FROM pg_sleep(31.5)`); }
  catch (error) { status = error.getStatus?.(); }
  assert.equal(status, 408);
  const timedOutMs = Math.round(performance.now() - started);
  const [active] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%pg_sleep(31.5)%'`;
  assert.equal(active.count, 0, 'Export deadline cancels SQL on its own transaction');
  console.log(JSON.stringify({ check: 'Export deadline and SQL cancellation', status,
    timedOutMs, activeQueriesAfterDeadline: active.count }));
};
