import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptRoot, '..');
const repositoryRoot = resolve(backendRoot, '..');
const frontendRoot = join(repositoryRoot, 'cronox-front');
const modules = [
  'users',
  'orders',
  'products',
  'inventory',
  'circles',
  'promo-codes',
  'audit',
];
const requireFromBackend = createRequire(join(backendRoot, 'package.json'));
const { withTestEnvironment } = requireFromBackend(
  './test/test-environment.cjs',
);

const fail = (message) => {
  throw new Error(`Admin export smoke failed: ${message}`);
};

const assertArtifacts = () => {
  const controllerPath = join(
    backendRoot,
    'dist',
    'admin',
    'exports',
    'admin-exports.controller.js',
  );
  const modulePath = join(backendRoot, 'dist', 'admin', 'admin.module.js');
  const mainPath = join(backendRoot, 'dist', 'main.js');
  const sourceApiPath = join(frontendRoot, 'src', 'admin', 'api.ts');
  const bundleApiPath = join(frontendRoot, 'assets', 'api.js');
  for (const path of [
    controllerPath,
    modulePath,
    mainPath,
    sourceApiPath,
    bundleApiPath,
  ]) {
    if (!existsSync(path)) fail(`missing artifact ${path}`);
  }

  const controller = readFileSync(controllerPath, 'utf8');
  const adminModule = readFileSync(modulePath, 'utf8');
  const sourceApi = readFileSync(sourceApiPath, 'utf8');
  const bundleApi = readFileSync(bundleApiPath, 'utf8');
  if (!controller.includes("Controller)('admin/exports')")) {
    fail('compiled controller has no admin/exports route prefix');
  }
  for (const route of modules) {
    if (!controller.includes(`Get)('${route}')`)) {
      fail(`compiled controller has no GET route for ${route}`);
    }
  }
  if (!adminModule.includes('AdminExportsController')) {
    fail('compiled AdminModule does not register AdminExportsController');
  }
  for (const contents of [sourceApi, bundleApi]) {
    if (!contents.includes('/api/admin/exports/')) {
      fail(
        'frontend source or bundle does not contain the canonical export URL',
      );
    }
    if (
      !contents.includes(
        'No se ha podido preparar el archivo Excel. Inténtalo de nuevo.',
      ) ||
      !contents.includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    ) {
      fail(
        'frontend source and bundle do not share the safe XLSX response contract',
      );
    }
  }
  try {
    requireFromBackend.resolve('exceljs');
  } catch {
    fail('exceljs cannot be resolved from backend production dependencies');
  }
};

const checkRoutes = async (baseUrl) => {
  for (const module of modules) {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/admin/exports/${module}?scope=all`,
      { redirect: 'manual' },
    );
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    if (response.status !== 401 && response.status !== 429) {
      fail(
        `${module} returned ${response.status} (${contentType}) instead of protected-route 401/429: ${body.slice(0, 120)}`,
      );
    }
    if (/Cannot GET/i.test(body) || /text\/html/i.test(contentType)) {
      fail(`${module} resolved to a raw/static 404 response`);
    }
  }
};

const waitForRoutes = async (baseUrl, child) => {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`compiled application exited with ${child.exitCode}`);
    }
    try {
      await checkRoutes(baseUrl);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw lastError ?? new Error('compiled application did not become ready');
};

const runCompiled = async () => {
  const port = Number(process.env.CRONOX_SMOKE_PORT || 43119);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [join(backendRoot, 'dist', 'main.js')],
    {
      cwd: backendRoot,
      env: withTestEnvironment(process.env, {
        force: true,
        overrides: {
          PORT: String(port),
          CRONOX_ROUTE_SMOKE_MODE: 'true',
        },
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  child.stdout.on('data', (chunk) => (diagnostics += chunk.toString()));
  child.stderr.on('data', (chunk) => (diagnostics += chunk.toString()));
  try {
    await waitForRoutes(baseUrl, child);
  } catch (error) {
    process.stderr.write(diagnostics.slice(-4000));
    throw error;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
};

assertArtifacts();
if (process.argv.includes('--compiled')) {
  await runCompiled();
} else if (process.argv.includes('--url')) {
  const baseUrl = process.env.CRONOX_SMOKE_BASE_URL;
  if (!baseUrl) fail('CRONOX_SMOKE_BASE_URL is required with --url');
  await checkRoutes(baseUrl);
}
process.stdout.write('Admin export artifacts and routes verified.\n');
