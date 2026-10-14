import {
  CorreosApiError,
  retryAfterMs,
  tokenExpiry,
  TrackpubClient,
} from './trackpub.client';

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const NUMBER = 'PQ1X2X1234567890123456X';
const identityUrl = 'https://apioauthcid.correos.es/Api/Authorize/Token';
const searchUrl = `https://api1.correos.es/support/trackpub/api/v2/search/${NUMBER}`;
const jwt = (exp: unknown) =>
  `unsigned.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.fixture`;
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const token = (value = 'inert-test-token') =>
  json({ idToken: value, tokenType: 'Bearer', expiresIn: 30 });

describe('Correos token lifetime and Retry-After', () => {
  it('uses the documented thirty MINUTES with a one-minute margin for opaque tokens', () => {
    expect(tokenExpiry('inert-opaque-token', NOW)).toBe(NOW + 29 * 60_000);
  });

  it.each(['not-json', 'e30', Buffer.from('{').toString('base64url')])(
    'keeps the conservative minute fallback for malformed JWT payload %s',
    (payload) => {
      expect(tokenExpiry(`unsigned.${payload}.fixture`, NOW)).toBe(
        NOW + 29 * 60_000,
      );
    },
  );

  it('uses the earlier JWT exp only for renewal scheduling', () => {
    expect(tokenExpiry(jwt(NOW / 1000 + 300), NOW)).toBe(NOW + 4 * 60_000);
    expect(tokenExpiry(jwt(NOW / 1000 + 7200), NOW)).toBe(NOW + 29 * 60_000);
    expect(tokenExpiry(jwt(NOW / 1000 - 1), NOW)).toBeLessThan(NOW);
  });

  it.each([null, '1800000000', {}, []])(
    'ignores a nonnumeric exp (%j)',
    (exp) => {
      expect(tokenExpiry(jwt(exp), NOW)).toBe(NOW + 29 * 60_000);
    },
  );

  it.each([
    ['30', 30_000],
    ['1.5', 1500],
    ['0', 0],
    ['Wed, 14 Oct 2026 10:02:00 GMT', 120_000],
    ['Wed, 14 Oct 2026 09:59:00 GMT', 0],
    ['not-a-date', 0],
    [null, 0],
  ])(
    'interprets Retry-After %s without a negative delay',
    (value, expected) => {
      expect(retryAfterMs(value, NOW)).toBe(expected);
    },
  );
});

describe('TrackpubClient with exclusively simulated transport', () => {
  const originalEnvironment = { ...process.env };
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let clock: jest.SpiedFunction<typeof Date.now>;
  let client: TrackpubClient;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      CORREOS_TRACKING_ENABLED: 'true',
      CORREOS_IDENTITY_CLIENT_ID: 'identity-id-inert-fixture',
      CORREOS_IDENTITY_CLIENT_SECRET: 'identity-secret-inert-fixture',
      CORREOS_DEVELOPERS_CLIENT_ID: 'developers-id-inert-fixture',
      CORREOS_DEVELOPERS_CLIENT_SECRET: 'developers-secret-inert-fixture',
      CORREOS_TIMEOUT_MS: '100',
      CORREOS_SYNC_INTERVAL_SECONDS: '1800',
      CORREOS_MANUAL_COOLDOWN_SECONDS: '60',
      CORREOS_SYNC_CONCURRENCY: '2',
      CORREOS_REQUEST_SPACING_MS: '1000',
      DATABASE_URL:
        'postgresql://fixture:fixture@127.0.0.1:1/unused_trackpub_test',
      EMAIL_ENABLED: 'false',
      BACKGROUND_JOBS_ENABLED: 'false',
      MAILBOX_SEND_ENABLED: 'false',
    };
    clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    // Any unconfigured call fails here; no test can fall through to real fetch.
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('UNEXPECTED_MOCK_REQUEST'));
    client = new TrackpubClient();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.restoreAllMocks();
  });

  const successfulSearch = () => json({ code: NUMBER, events: [] });

  it('keeps Identity credentials in the form and Developers credentials in Trackpub headers', async () => {
    fetchMock
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(successfulSearch());
    await expect(client.search(NUMBER)).resolves.toEqual({
      code: NUMBER,
      events: [],
    });
    const [identityRequest, apiRequest] = fetchMock.mock.calls;
    expect(identityRequest[0]).toBe(identityUrl);
    expect(identityRequest[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'es-ES',
      },
    });
    expect(
      Object.fromEntries(identityRequest[1]!.body as URLSearchParams),
    ).toEqual({
      scope: 'TPB',
      grant_type: 'client_credentials',
      client_id: 'identity-id-inert-fixture',
      client_secret: 'identity-secret-inert-fixture',
    });
    expect(apiRequest[0]).toBe(searchUrl);
    expect(apiRequest[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer inert-test-token',
        client_id: 'developers-id-inert-fixture',
        client_secret: 'developers-secret-inert-fixture',
      },
    });
    expect(apiRequest[1]!.body).toBeUndefined();
    expect(identityRequest[1]!.signal).toBeInstanceOf(AbortSignal);
    expect(apiRequest[1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('caches the token for minutes, then renews before expiration', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === identityUrl ? token() : successfulSearch(),
    );
    await client.search(NUMBER);
    clock.mockReturnValue(NOW + 30_000);
    await client.search(NUMBER);
    clock.mockReturnValue(NOW + 28 * 60_000);
    await client.search(NUMBER);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === identityUrl),
    ).toHaveLength(1);
    clock.mockReturnValue(NOW + 29 * 60_000);
    await client.search(NUMBER);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === identityUrl),
    ).toHaveLength(2);
  });

  it('shares one in-flight token request between simultaneous searches', async () => {
    let resolveToken!: (response: Response) => void;
    const pendingToken = new Promise<Response>((resolve) => {
      resolveToken = resolve;
    });
    fetchMock.mockImplementation(async (url) =>
      String(url) === identityUrl ? pendingToken : successfulSearch(),
    );
    const searches = Promise.all([
      client.search(NUMBER),
      client.search(NUMBER),
      client.search(NUMBER),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveToken(token());
    await searches;
    expect(
      fetchMock.mock.calls.filter(([url]) => url === identityUrl),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === searchUrl),
    ).toHaveLength(3);
  });

  it('renews once after 401 and repeats the original GET with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(token('inert-old-token'))
      .mockResolvedValueOnce(json({ title: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(token('inert-new-token'))
      .mockResolvedValueOnce(successfulSearch());
    await expect(client.search(NUMBER)).resolves.toEqual({
      code: NUMBER,
      events: [],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      identityUrl,
      searchUrl,
      identityUrl,
      searchUrl,
    ]);
    expect(fetchMock.mock.calls[3][1]!.headers).toMatchObject({
      Authorization: 'Bearer inert-new-token',
    });
  });

  it('does not enter an authentication loop when the renewed token is also rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(token('inert-old-token'))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(token('inert-new-token'))
      .mockResolvedValueOnce(json({}, 401));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'TRACKPUB_HTTP_401',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('shares a single renewal when simultaneous searches reject the same expired token', async () => {
    let identityCalls = 0;
    let oldSearches = 0;
    let bothOldRequests!: () => void;
    let renewalStarted!: () => void;
    let resolveRenewal!: (response: Response) => void;
    const bothStarted = new Promise<void>((resolve) => {
      bothOldRequests = resolve;
    });
    const renewal = new Promise<void>((resolve) => {
      renewalStarted = resolve;
    });
    const renewedToken = new Promise<Response>((resolve) => {
      resolveRenewal = resolve;
    });
    const rejectedRequests: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url) === identityUrl) {
        identityCalls++;
        if (identityCalls === 1) return token('inert-old-token');
        renewalStarted();
        return renewedToken;
      }
      if (
        new Headers(options?.headers).get('Authorization') ===
        'Bearer inert-old-token'
      ) {
        oldSearches++;
        if (oldSearches === 1) return successfulSearch();
        return new Promise<Response>((resolve) => {
          rejectedRequests.push(resolve);
          if (rejectedRequests.length === 2) bothOldRequests();
        });
      }
      return successfulSearch();
    });
    await client.search(NUMBER);
    const concurrent = Promise.all([
      client.search(NUMBER),
      client.search(NUMBER),
    ]);
    await bothStarted;
    rejectedRequests.forEach((resolve) => resolve(json({}, 401)));
    await renewal;
    resolveRenewal(token('inert-new-token'));
    await concurrent;
    expect(identityCalls).toBe(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === searchUrl),
    ).toHaveLength(5);
  });

  it('a late 401 from an older request cannot invalidate a replacement token', async () => {
    let identityCalls = 0;
    let oldSearches = 0;
    let bothOldRequests!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      bothOldRequests = resolve;
    });
    const rejectedRequests: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url) === identityUrl) {
        identityCalls++;
        return token(
          identityCalls === 1 ? 'inert-old-token' : 'inert-new-token',
        );
      }
      if (
        new Headers(options?.headers).get('Authorization') ===
        'Bearer inert-old-token'
      ) {
        oldSearches++;
        if (oldSearches === 1) return successfulSearch();
        return new Promise<Response>((resolve) => {
          rejectedRequests.push(resolve);
          if (rejectedRequests.length === 2) bothOldRequests();
        });
      }
      return successfulSearch();
    });
    await client.search(NUMBER);
    const first = client.search(NUMBER);
    const late = client.search(NUMBER);
    await bothStarted;
    rejectedRequests[0](json({}, 401));
    await first;
    rejectedRequests[1](json({}, 401));
    await late;
    expect(identityCalls).toBe(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === searchUrl),
    ).toHaveLength(5);
  });

  it('does not repeatedly renew valid tokens after a Developers permission failure (403)', async () => {
    fetchMock
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({}, 403));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'TRACKPUB_HTTP_403',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['25', 25_000],
    ['Wed, 14 Oct 2026 10:02:00 GMT', 120_000],
  ])(
    'returns the 429 retry delay to the persistent scheduler (%s)',
    async (delay, expected) => {
      fetchMock
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(json({}, 429, { 'Retry-After': delay }));
      await expect(client.search(NUMBER)).rejects.toMatchObject({
        code: 'TRACKPUB_HTTP_429',
        retryAfterMs: expected,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 404, 500, 502, 503])(
    'classifies HTTP %s without exposing the provider body',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(
          json({ body: 'private-provider-fixture' }, status),
        );
      await expect(client.search(NUMBER)).rejects.toEqual(
        new CorreosApiError(`TRACKPUB_HTTP_${status}`),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('passes Identity rate limiting through with its own error code', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '12' }));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'IDENTITY_HTTP_429',
      retryAfterMs: 12_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { idToken: '', tokenType: 'Bearer' },
    { idToken: 123, tokenType: 'Bearer' },
    { idToken: 'inert-fixture', tokenType: 'Basic' },
  ])(
    'rejects malformed Identity response %j before querying Trackpub',
    async (body) => {
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(client.search(NUMBER)).rejects.toMatchObject({
        code: 'INVALID_TOKEN_RESPONSE',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses an already expired JWT instead of sending it to Trackpub', async () => {
    fetchMock.mockResolvedValueOnce(token(jwt(NOW / 1000 - 1)));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can retry after a rejected token request without keeping a failed promise', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(successfulSearch());
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'IDENTITY_HTTP_503',
    });
    await expect(client.search(NUMBER)).resolves.toEqual({
      code: NUMBER,
      events: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['AbortError', 'TimeoutError', 'TypeError'])(
    'classifies simulated network failure %s',
    async (name) => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('inert simulated transport failure'), { name }),
      );
      await expect(client.search(NUMBER)).rejects.toMatchObject({
        code: 'NETWORK_OR_TIMEOUT',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('enforces the configured timeout signal on a simulated pending request', async () => {
    fetchMock.mockImplementationOnce(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(new Error('simulated abort')),
            { once: true },
          );
        }),
    );
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'NETWORK_OR_TIMEOUT',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['{', '<html>inert error</html>'])(
    'rejects a non-JSON response body (%s)',
    async (body) => {
      fetchMock
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(new Response(body));
      await expect(client.search(NUMBER)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it('rejects a missing response stream', async () => {
    fetchMock
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('caps decoded response data at one MiB', async () => {
    fetchMock
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)));
    await expect(client.search(NUMBER)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it.each([
    ['CORREOS_TRACKING_ENABLED', 'false', 'TRACKING_DISABLED'],
    ['CORREOS_DEVELOPERS_CLIENT_ID', '', 'DEVELOPERS_NOT_CONFIGURED'],
    ['CORREOS_DEVELOPERS_CLIENT_SECRET', '', 'DEVELOPERS_NOT_CONFIGURED'],
    ['CORREOS_IDENTITY_CLIENT_ID', '', 'IDENTITY_NOT_CONFIGURED'],
    ['CORREOS_IDENTITY_CLIENT_SECRET', '', 'IDENTITY_NOT_CONFIGURED'],
  ])(
    'fails closed without external calls for missing %s',
    async (key, value, code) => {
      process.env[key] = value;
      await expect(client.search(NUMBER)).rejects.toMatchObject({ code });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', '../tracking', 'AA000?token=bad', 'x'.repeat(81)])(
    'rejects unsafe tracking identifier %s',
    async (number) => {
      await expect(client.search(number)).rejects.toMatchObject({
        code: 'INVALID_TRACKING_NUMBER',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
