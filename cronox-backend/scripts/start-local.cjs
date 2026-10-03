'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const configPath = path.join(backend, '.env.local');

function loadLocalEnvironment() {
  if (!fs.existsSync(configPath)) throw new Error('Falta cronox-backend/.env.local. Consulta docs/local-development.md.');
  const dotenv = require('dotenv');
  const local = dotenv.parse(fs.readFileSync(configPath));
  const deployment = fs.existsSync(path.join(backend, '.env'))
    ? dotenv.parse(fs.readFileSync(path.join(backend, '.env'))) : {};
  const env = buildLocalEnvironment(local, process.env, Object.keys(deployment));
  // Explicit mailbox-only opt-in: resolve current references at every startup,
  // without persisting a second copy of the operator's SMTP passwords.
  if (local.MAILBOX_LOCAL_SMTP_REFERENCES === 'true') {
    for (const key of ['SMTP_HOST', ...['SUPPORT', 'ORDERS', 'NOREPLY', 'INFO']
      .flatMap(name => [`SMTP_${name}_USER`, `SMTP_${name}_PASS`])]) {
      env[key] = deployment[key] || '';
    }
  }
  return env;
}

function buildLocalEnvironment(local, inherited, deploymentKeys = []) {
  const loopback = value => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  if (local.NODE_ENV !== 'development' || !loopback(local.DATABASE_URL) || !loopback(local.DIRECT_URL)) {
    throw new Error('El arranque local exige NODE_ENV=development y bases PostgreSQL locales.');
  }
  const database = new URL(local.DATABASE_URL), direct = new URL(local.DIRECT_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.origin !== direct.origin || database.pathname !== direct.pathname || database.host !== direct.host) {
    throw new Error('DATABASE_URL y DIRECT_URL deben señalar la misma base PostgreSQL local.');
  }
  if (!loopback(local.FRONTEND_URL) || !loopback(local.API_PUBLIC_URL) ||
      local.EMAIL_ENABLED !== 'false' || local.BACKGROUND_JOBS_ENABLED !== 'false' ||
      local.WAITLIST_EMAIL_WORKER_ENABLED !== 'false' || local.SUPABASE_URL || local.SUPABASE_SERVICE_ROLE_KEY ||
      local.MAILBOX_WORKER_ENABLED === 'true' || local.MAILBOX_SEND_ENABLED === 'true' ||
      !local.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('La configuración local debe desactivar correo, trabajos y almacenamiento externo, y usar claves Stripe de prueba.');
  }
  // Do not inherit deployment values, including variables absent from .env.local.
  const env = { ...inherited };
  for (const key of new Set([...Object.keys(env), ...deploymentKeys])) {
    // Explicit empty values also prevent Prisma's automatic .env expansion from
    // repopulating deployment credentials that are absent in the local file.
    if (deploymentKeys.includes(key) || /^(?:MAILBOX_|SMTP_|EMAIL_|SUPABASE_|STRIPE_|JWT_|DATABASE_URL$|DIRECT_URL$|DOTENV_|CRONOX_ROUTE_SMOKE_MODE$)/.test(key)) env[key] = '';
  }
  return { ...env, ...local, DOTENV_CONFIG_PATH: configPath, CRONOX_ENV_FILE: configPath, CRONOX_LOCAL_DEV: 'true', HOST: '127.0.0.1' };
}

function ensureLocalPostgres(env) {
  if (!env.LOCAL_PG_BIN || !env.LOCAL_PG_DATA) return;
  const executable = path.join(env.LOCAL_PG_BIN, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  const options = { env, windowsHide: true, stdio: 'ignore' };
  const status = spawnSync(executable, ['-D', env.LOCAL_PG_DATA, 'status'], options);
  if (status.status === 0) return;
  const port = new URL(env.DATABASE_URL).port || '5432';
  const start = spawnSync(executable, ['-D', env.LOCAL_PG_DATA, '-l', path.join(env.LOCAL_PG_DATA, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], options);
  if (start.status !== 0) throw new Error('No se pudo iniciar PostgreSQL local. Consulta su server.log.');
}

if (require.main === module) {
  try {
    const env = loadLocalEnvironment();
    ensureLocalPostgres(env);
    const migrate = process.argv.includes('--migrate');
    const watch = process.argv.includes('--watch');
    const args = migrate ? [require.resolve('prisma/build/index.js'), 'migrate', 'deploy']
      : watch ? [require.resolve('@nestjs/cli/bin/nest.js'), 'start', '--watch']
      : [path.join(backend, 'dist/main.js')];
    const url = new URL(env.DATABASE_URL);
    console.log(`[local] ${env.FRONTEND_URL} -> PostgreSQL ${url.hostname}:${url.port}${url.pathname}; correo y trabajos desactivados.`);
    const child = spawn(process.execPath, args, { cwd: backend, env, stdio: 'inherit', windowsHide: true });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    child.on('error', () => { console.error('No se pudo iniciar el proceso local.'); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { loadLocalEnvironment, ensureLocalPostgres, buildLocalEnvironment };
