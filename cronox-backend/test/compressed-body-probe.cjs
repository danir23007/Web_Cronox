'use strict';
// Real loopback HTTP in a child: an uncaught decoder error must fail the test,
// never take down Jest or contact an application/database/provider.
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const assert = require('node:assert/strict');
const scenario = process.argv[2];
if (!['valid', 'late-trailing', 'over-limit'].includes(scenario)) throw Error('UNKNOWN_SCENARIO');
const app = express();
app.use(express.json({ limit: '1kb' }));
app.post('/probe', (req, res) => {
  assert.deepEqual(req.body, { synthetic: true });
  // Keep the connection open after parsing so trailing chunks reach the
  // decoder before the response/socket closes (GHSA-27r3-jxmh-p828).
  setTimeout(() => res.json({ accepted: true }), 60);
});
app.get('/health', (_req, res) => res.json({ alive: true }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ rejected: true }));
const server = http.createServer(app);
const timeout = setTimeout(() => { console.error('PROBE_TIMEOUT'); process.exit(1); }, 5000);
const send = (port, options, write) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, agent: false, ...options }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    res.on('error', reject);
  });
  req.on('error', reject);
  write(req);
});
server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const data = Buffer.from(JSON.stringify(scenario === 'over-limit' ? { synthetic: 'x'.repeat(2048) } : { synthetic: true }));
    const compressed = scenario === 'late-trailing'
      ? Buffer.concat([zlib.gzipSync(data), Buffer.from([0])]) : zlib.deflateSync(data);
    const tail = scenario === 'late-trailing' ? Buffer.alloc(100 * 1024, 0x58) : Buffer.alloc(0);
    const result = await send(port, { path: '/probe', method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Encoding': scenario === 'late-trailing' ? 'gzip' : 'deflate', 'Content-Length': compressed.length + tail.length,
    } }, req => {
      if (tail.length) { req.write(compressed); setTimeout(() => req.end(tail), 25); }
      else req.end(compressed);
    });
    assert.equal(result.status, scenario === 'over-limit' ? 413 : 200);
    const health = await send(port, { path: '/health' }, req => req.end());
    assert.deepEqual(health, { status: 200, body: { alive: true } });
    console.log(JSON.stringify({ scenario, status: result.status, healthy: true }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    server.close();
  }
});
