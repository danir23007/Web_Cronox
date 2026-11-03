const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../../output/performance-20261103');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
const versions = process.argv.slice(2);
for (const version of (versions.length ? versions : ['before', 'after'])) for (const device of ['mobile', 'desktop']) for (const cache of ['cold', 'warm']) {
  const runs = [1, 2, 3].map(run => {
    const base = path.join(out, version, `${device}-${run}-${cache}`);
    if (!fs.existsSync(base + '.lhr.json')) return null;
    const result = JSON.parse(fs.readFileSync(base + '.lhr.json'));
    const evidence = JSON.parse(fs.readFileSync(base + '.evidence.json'));
    const a = result.audits;
    const screenshot = a['final-screenshot'].details.data;
    fs.writeFileSync(base + '.lighthouse.jpg', Buffer.from(screenshot.split(',')[1], 'base64'));
    return { score: result.categories.performance.score * 100, fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue, si: a['speed-index'].numericValue, tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue, bytes: a['total-byte-weight'].numericValue, reveal: evidence.reveal, visible: evidence.visible, lcpElement: a['lcp-breakdown-insight']?.details?.items?.find(x => x.type === 'node')?.selector };
  }).filter(Boolean);
  if (runs.length !== 3) continue;
  rows.push({ version, device, cache, runs, median: Object.fromEntries(Object.keys(runs[0]).filter(k => k !== 'lcpElement').map(k => [k, median(runs.map(r => r[k]))])) });
}
fs.writeFileSync(path.join(out, versions.length ? 'summary-public.json' : 'summary.json'), JSON.stringify(rows, null, 2));
console.log(rows.map(({ version, device, cache, median: m }) => `| ${version} | ${device} ${cache} | ${m.score} | ${(m.fcp/1000).toFixed(2)} | ${(m.lcp/1000).toFixed(2)} | ${(m.si/1000).toFixed(2)} | ${Math.round(m.tbt)} | ${m.cls.toFixed(3)} | ${Math.round(m.bytes/1024)} | ${(m.visible/1000).toFixed(2)} |`).join('\n'));
