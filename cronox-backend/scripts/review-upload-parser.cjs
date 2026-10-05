// One bounded multipart regression, in a disposable child process on loopback.
'use strict';
const assert = require('node:assert/strict');
if (!process.argv.includes('--worker')) {
  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, [__filename, '--worker'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const crashed = /RangeError: Invalid array length/.test(child.stderr || '');
  console.log(JSON.stringify({ package: 'multer', version: require('multer/package.json').version, childExit: child.status, uncaughtRangeError: crashed, result: child.stdout.trim() }));
  if (!process.argv.includes('--diagnose')) assert.equal(child.status, 0, 'multipart parser must reject malformed fields without terminating the process');
} else {
  const http = require('node:http'), multer = require('multer');
  const upload = multer({ limits: { fields: 4, fieldSize: 100, files: 1 } }).single('file');
  const server = http.createServer((req, res) => upload(req, res, err => {
    res.statusCode = err ? 400 : 200; res.end(err?.code || 'ok');
  }));
  server.listen(0, '127.0.0.1', async () => {
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const malformed = new FormData(); malformed.set('items[4294967294]', 'x'); malformed.set('items[]', 'y');
      const response = await fetch(url, { method: 'POST', body: malformed }); assert.equal(response.status, 400);
      const valid = new FormData(); valid.set('title', 'Sample'); valid.set('file', new Blob(['sample bytes']), 'sample.txt');
      assert.equal((await fetch(url, { method: 'POST', body: valid })).status, 200);
      console.log('PASS: malformed fields rejected; next ordinary upload succeeds');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { server.close(); }
  });
}
