import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromBackend = createRequire(`${backendRoot}/package.json`);
const { TEST_ENVIRONMENT_KEYS, withTestEnvironment } = requireFromBackend(
  './test/test-environment.cjs',
);

const environmentWithoutLocalConfiguration = { ...process.env };
for (const key of TEST_ENVIRONMENT_KEYS) {
  delete environmentWithoutLocalConfiguration[key];
}
const environment = withTestEnvironment(environmentWithoutLocalConfiguration, {
  force: true,
});

const child = spawn(
  process.execPath,
  [
    resolve(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js'),
    '--runInBand',
    'src/admin/exports',
    'src/frontend/admin-excel',
  ],
  {
    cwd: backendRoot,
    env: environment,
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Export tests terminated by ${signal}`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
