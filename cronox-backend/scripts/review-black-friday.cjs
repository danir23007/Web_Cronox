'use strict';
// Reuse the protected local environment, with all payment workers disabled too.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const env = loadLocalEnvironment();
ensureLocalPostgres(env);
for (const name of ['CHECKOUT_RESERVATION_WORKER_ENABLED', 'STRIPE_WEBHOOK_WORKER_ENABLED', 'MAILBOX_SEND_ENABLED', 'MAILBOX_WORKER_ENABLED']) env[name] = 'false';
console.log('[Black Friday local] http://localhost:3000 · correo, trabajos y workers de pago desactivados');
const child = spawn(process.execPath, [path.resolve(__dirname, '../dist/main.js')], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
