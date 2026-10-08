'use strict';
const { loadLocalEnvironment } = require('./start-local.cjs');
const { PrismaClient } = require('@prisma/client');
const { repairNewsletterUsers } = require('../dist/newsletter/newsletter-user-repair');
const apply = process.argv.includes('--apply');
const envName = process.argv.find(arg => arg.startsWith('--audit-url-env='))?.split('=')[1];
// Explicit external audit is read-only; there is no production apply option.
if (apply && envName) throw new Error('External database repair is prohibited');
const url = envName ? process.env[envName] : loadLocalEnvironment().DATABASE_URL;
if (!url) throw new Error('Database URL missing');
if (apply && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Apply requires protected local PostgreSQL');
const db = new PrismaClient({ datasources: { db: { url } } });
repairNewsletterUsers(db, apply).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error('Audit/repair failed (' + (error.code || error.message) + '); no accounts were merged and no mail was sent. Review collisions and migration locally.'); if (process.argv.includes('--diagnose') && !envName) console.error(error.meta); process.exitCode = 1; })
  .finally(() => db.$disconnect());
