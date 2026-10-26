import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('compressed request body process safety', () => {
  it.each(['valid', 'late-trailing', 'over-limit'])('%s preserves a healthy server and the body limit', scenario => {
    const probe = spawnSync(process.execPath, [resolve(__dirname, '../../test/compressed-body-probe.cjs'), scenario], {
      encoding: 'utf8', timeout: 7000, windowsHide: true,
    });
    expect({ status: probe.status, stderr: probe.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(probe.stdout)).toEqual({ scenario, status: scenario === 'over-limit' ? 413 : 200, healthy: true });
  });
});
