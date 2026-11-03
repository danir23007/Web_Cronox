const { spawn } = require('node:child_process');
const path = require('node:path');
const { loadLocalEnvironment, ensureLocalPostgres } = require('../../cronox-backend/scripts/start-local.cjs');
const env = loadLocalEnvironment();
ensureLocalPostgres(env);
Object.assign(env, {
  PORT: '4197', FRONTEND_URL: 'http://localhost:4197', API_PUBLIC_URL: 'http://localhost:4197',
  CORS_ORIGINS: 'http://localhost:4197', LOCAL_CHECKOUT_STRIPE_TEST: 'false',
  CRONOX_LOCAL_CHECKOUT_TEST: 'false', CHECKOUT_RESERVATION_WORKER_ENABLED: 'false',
  STRIPE_WEBHOOK_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false',
});
const child = spawn(process.execPath, [path.resolve(__dirname, '../../cronox-backend/dist/main.js')], {
  cwd: path.resolve(__dirname, '../../cronox-backend'), env, stdio: 'inherit', windowsHide: true,
});
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
