import { randomUUID } from 'node:crypto';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';

export type RecoveryOperationalStatus = {
  enabled: boolean;
  disabledReason: string | null;
  lastScanCompletedAt: Date | null;
  lastScanError: string | null;
};

// Private file, not a new HTTP route or an authentication bypass. No customer/event data.
export function writeRecoveryOperationalStatus(status: RecoveryOperationalStatus): void {
  const file = process.env.CRONOX_RECOVERY_STATUS_FILE;
  if (!file) return;
  if (file !== '/var/lib/cronox-pm2/recovery-status.json') throw new Error('INVALID_RECOVERY_STATUS_PATH');
  const temporary = file + '.' + process.pid + '.' + randomUUID();
  try {
    writeFileSync(temporary, JSON.stringify({
      pid: process.pid, writtenAt: Date.now(),
      enabled: status.enabled, disabledReason: status.disabledReason,
      lastScanCompletedAt: status.lastScanCompletedAt,
      lastScanError: status.lastScanError,
    }), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch { /* rename already removed it */ }
  }
}

// Independent, private evidence for the reservation worker. Reuses the existing
// explicitly configured runtime directory; no HTTP route or customer payloads.
export function writeCheckoutReservationOperationalStatus(status: {
  enabled: boolean; running: boolean; pollIntervalMs: number; retryDelayMs: number;
  lastScanCompletedAt: Date | null; lastScanError: string | null;
}): void {
  if (!process.env.CRONOX_RECOVERY_STATUS_FILE) return;
  if (process.env.CRONOX_RECOVERY_STATUS_FILE !== '/var/lib/cronox-pm2/recovery-status.json') throw new Error('INVALID_RECOVERY_STATUS_PATH');
  const file='/var/lib/cronox-pm2/reservation-status.json',temporary=file+'.'+process.pid+'.'+randomUUID();
  try {
    writeFileSync(temporary,JSON.stringify({pid:process.pid,writtenAt:Date.now(),enabled:status.enabled,running:status.running,
      pollIntervalMs:status.pollIntervalMs,retryDelayMs:status.retryDelayMs,lastScanCompletedAt:status.lastScanCompletedAt,lastScanError:status.lastScanError}),{mode:0o600,flag:'wx'});
    renameSync(temporary,file);
  }finally{try{unlinkSync(temporary);}catch{}}
}
