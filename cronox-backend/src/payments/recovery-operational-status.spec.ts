jest.mock('node:fs', () => ({ writeFileSync: jest.fn(), renameSync: jest.fn(), unlinkSync: jest.fn() }));
import { writeFileSync, renameSync } from 'node:fs';
import { writeRecoveryOperationalStatus } from './recovery-operational-status';

describe('private deployment recovery telemetry', () => {
  const original = process.env.CRONOX_RECOVERY_STATUS_FILE;
  const state = { enabled: true, disabledReason: null, lastScanCompletedAt: new Date(), lastScanError: null };
  afterEach(() => {
    jest.clearAllMocks();
    if (original === undefined) delete process.env.CRONOX_RECOVERY_STATUS_FILE;
    else process.env.CRONOX_RECOVERY_STATUS_FILE = original;
  });
  it('does nothing unless explicitly configured', () => {
    delete process.env.CRONOX_RECOVERY_STATUS_FILE;
    writeRecoveryOperationalStatus(state);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
  it('rejects paths outside the fixed private runtime directory', () => {
    process.env.CRONOX_RECOVERY_STATUS_FILE = '/tmp/public.json';
    expect(() => writeRecoveryOperationalStatus(state)).toThrow('INVALID_RECOVERY_STATUS_PATH');
    expect(writeFileSync).not.toHaveBeenCalled();
  });
  it('atomically publishes only allowlisted fields with private permissions', () => {
    process.env.CRONOX_RECOVERY_STATUS_FILE = '/var/lib/cronox-pm2/recovery-status.json';
    writeRecoveryOperationalStatus({ ...state, payload: 'private' } as any);
    const [path, bytes, options] = (writeFileSync as jest.Mock).mock.calls[0];
    expect(options).toEqual({ mode: 0o600, flag: 'wx' });
    expect(JSON.parse(bytes)).toEqual({ ...state, lastScanCompletedAt: state.lastScanCompletedAt.toISOString(), pid: process.pid, writtenAt: expect.any(Number) });
    expect(bytes).not.toContain('private');
    expect(renameSync).toHaveBeenCalledWith(path, process.env.CRONOX_RECOVERY_STATUS_FILE);
  });
});
