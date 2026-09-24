/** Only explicit rejection / proven pre-connection failures are retryable. */
export class RestockDeliveryError extends Error {
  constructor(public readonly outcome: 'RETRY' | 'FAILED' | 'UNCERTAIN') {
    super(`RESTOCK_DELIVERY_${outcome}`);
  }
}

export function restockDeliveryOutcome(
  error: unknown,
): 'RETRY' | 'FAILED' | 'UNCERTAIN' {
  const e = error as {
    code?: string;
    command?: string;
    responseCode?: number;
    accepted?: unknown[];
  };
  if (e?.accepted?.length) return 'UNCERTAIN';
  // Never interpret a post-acceptance QUIT failure as a rejected message.
  const rejection =
    /^(CONN|EHLO|HELO|AUTH(?: .*?)?|MAIL FROM|RCPT TO|DATA)$/.test(
      e?.command || '',
    );
  if (
    rejection &&
    e?.responseCode &&
    e.responseCode >= 400 &&
    e.responseCode < 500
  )
    return 'RETRY';
  if (
    rejection &&
    e?.responseCode &&
    e.responseCode >= 500 &&
    e.responseCode < 600
  )
    return 'FAILED';
  if (['EDNS', 'ECONNREFUSED'].includes(e?.code || '')) return 'RETRY';
  return 'UNCERTAIN';
}
