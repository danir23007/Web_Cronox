'use strict';
// Read-only release check. Never prints matches, keys, env values or file content.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function forbiddenFile(file) {
  const name = file.replaceAll('\\', '/');
  return /(^|\/)\.env(?:\..*)?$/.test(name) && !name.endsWith('/.env.example') && name !== '.env.example'
    || /(^|\/)(?:test-results|\.playwright-cli)(?:\/|$)/.test(name)
    || name.startsWith('output/playwright/')
    || /^cronox-backend\/scripts\/(?:checkout-sandbox[^/]*|init-checkout-sandbox-db|playwright-sandbox|test-bank-abuse-sandbox|test-bank-transfer-local|test-checkout-stripe-sandbox|verify-express-paypal-sandbox|verify-physical-wallets)\.cjs$/.test(name);
}

function inspect(files, artifacts, privateValues = []) {
  const failures = files.filter(forbiddenFile).map(file => `LOCAL_ONLY_FILE:${file}`);
  for (const [file, content] of artifacts) {
    if (forbiddenFile(file)) failures.push(`LOCAL_ONLY_ARTIFACT:${file}`);
    if (/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|pk_test_[A-Za-z0-9]{16,}/.test(content)
      || privateValues.some(value => value.length >= 8 && content.includes(value))) {
      failures.push(`PRIVATE_OR_TEST_CREDENTIAL:${file}`);
    }
  }
  return failures;
}

function main() {
  const root = path.resolve(__dirname, '../..');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const artifacts = [];
  for (const folder of ['cronox-front', 'cronox-backend/dist']) {
    const absolute = path.join(root, folder);
    if (!fs.existsSync(absolute)) throw Error('PRODUCTION_ARTIFACTS_REQUIRED');
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const relative = path.relative(root, file).replaceAll('\\', '/');
        if (entry.isSymbolicLink()) throw Error(`ARTIFACT_SYMLINK_NOT_ALLOWED:${relative}`);
        if (entry.isDirectory()) visit(file);
        else if (forbiddenFile(relative) || /\.(?:[cm]?js|json|html|css|map|ts|txt)$/i.test(entry.name)) {
          artifacts.push([relative, fs.readFileSync(file, 'utf8')]);
        }
      }
    };
    visit(absolute);
  }
  // Compare local sandbox secrets too, without exposing them. CI/production
  // normally has no such file and uses the pattern/path checks above.
  const sandbox = path.join(root, 'cronox-backend/.env.stripe-sandbox');
  const privateValues = fs.existsSync(sandbox) ? fs.readFileSync(sandbox, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(?:STRIPE_\w*(?:KEY|SECRET)|PAYPAL_SANDBOX_BUYER_\w+|SANDBOX_ACCESS_CODE)\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    return [match[1].replace(/^(['"])(.*)\1$/, '$2')];
  }) : [];
  const failures = inspect(tracked, artifacts, privateValues);
  if (failures.length) throw Error(failures.join('\n'));
  console.log(`CHECKOUT_RELEASE_SAFETY_OK tracked=${tracked.length} artifacts=${artifacts.length}`);
}

module.exports = { forbiddenFile, inspect };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
