import { Injectable } from '@nestjs/common';
import { correosConfig } from './correos.config';

export class CorreosApiError extends Error {
  constructor(readonly code: string, readonly retryAfterMs = 0) { super(code); }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Number(value) * 1000);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : 0;
}

// exp is read only to schedule renewal; this is NOT JWT signature validation.
export function tokenExpiry(token: string, issuedAt: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(payload.exp)) return Math.min(payload.exp * 1000, issuedAt + 30 * 60000) - 60000;
  } catch { /* Opaque tokens use the confirmed 30-minute lifetime. */ }
  // Correos Identidad returns expiresIn=30 in minutes, not OAuth seconds.
  return issuedAt + 29 * 60000;
}

@Injectable()
export class TrackpubClient {
  private token?: { value: string; expiresAt: number };
  private renewing?: Promise<string>;

  private async json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new CorreosApiError('INVALID_RESPONSE');
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024 * 1024) throw new CorreosApiError('RESPONSE_TOO_LARGE');
        parts.push(part.value);
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch (error) {
      if (error instanceof CorreosApiError) throw error;
      throw new CorreosApiError('INVALID_RESPONSE');
    } finally { await reader.cancel().catch(() => {}); }
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(correosConfig().timeoutMs) });
    } catch { throw new CorreosApiError('NETWORK_OR_TIMEOUT'); }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      const config = correosConfig();
      if (!config.identityClientId || !config.identityClientSecret) throw new CorreosApiError('IDENTITY_NOT_CONFIGURED');
      const response = await this.request('https://apioauthcid.correos.es/Api/Authorize/Token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'Accept-Language': 'es-ES' },
        body: new URLSearchParams({ scope: 'TPB', grant_type: 'client_credentials', client_id: config.identityClientId, client_secret: config.identityClientSecret }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CorreosApiError(`IDENTITY_HTTP_${response.status}`, retryAfterMs(response.headers.get('retry-after')));
      }
      const body = await this.json(response) as { idToken?: unknown; tokenType?: unknown } | null;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.idToken !== 'string' || !body.idToken || body.tokenType !== 'Bearer') throw new CorreosApiError('INVALID_TOKEN_RESPONSE');
      const expiresAt = tokenExpiry(body.idToken, Date.now());
      if (expiresAt <= Date.now()) throw new CorreosApiError('TOKEN_EXPIRED');
      this.token = { value: body.idToken, expiresAt };
      return body.idToken;
    })();
    try { return await this.renewing; } finally { this.renewing = undefined; }
  }

  async search(number: string): Promise<unknown> {
    const config = correosConfig();
    if (!config.enabled) throw new CorreosApiError('TRACKING_DISABLED');
    if (!config.developersClientId || !config.developersClientSecret) throw new CorreosApiError('DEVELOPERS_NOT_CONFIGURED');
    if (!/^[a-z0-9]{5,80}$/i.test(number)) throw new CorreosApiError('INVALID_TRACKING_NUMBER');
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.request(`https://api1.correos.es/support/trackpub/api/v2/search/${encodeURIComponent(number)}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, client_id: config.developersClientId, client_secret: config.developersClientSecret, Accept: 'application/json' },
      });
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        // A concurrent request may already have replaced this token.
        if (this.token?.value === token) this.token = undefined;
        token = await this.accessToken();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CorreosApiError(`TRACKPUB_HTTP_${response.status}`, retryAfterMs(response.headers.get('retry-after')));
      }
      return this.json(response);
    }
    throw new CorreosApiError('AUTH_RETRY_EXHAUSTED');
  }
}
