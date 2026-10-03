import {
  encrypt,
  decrypt,
  publicAddress,
  resolvePublic,
  addresses,
  replyRecipients,
  safeHtml,
  messageDocument,
  serverConfig,
  safeFilename,
  keyring,
  safeError,
} from './mailbox-security';
import { mailboxPrivateRoot } from './mailbox-files.service';
import { resolve } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { smtpOutcome } from './mailbox-sender.service';
import { pinnedPushAgent, pushHost } from './mailbox-push.service';
import { createServer, connect } from 'node:net';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxWorkerService } from './mailbox-worker.service';

describe('Private mailbox security and delivery policy', () => {
  it('connects with Node automatic family selection using only the pinned address', async () => {
    const server = createServer((socket) => socket.end());
    const agent = pinnedPushAgent({ address: '127.0.0.1', family: 4 });
    try {
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      const address = server.address() as { port: number };
      await new Promise<void>((done, reject) => {
        const socket = connect({
          host: 'unresolvable-push.example.invalid',
          port: address.port,
          autoSelectFamily: true,
          lookup: agent.options.lookup,
        });
        socket.setTimeout(2000, () =>
          socket.destroy(new Error('PINNED_LOOKUP_TIMEOUT')),
        );
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.destroy();
          done();
        });
      });
    } finally {
      agent.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it('returns a single pinned IPv6 answer for both DNS lookup contracts', () => {
    const agent = pinnedPushAgent({
      address: '2001:4860:4860::8888',
      family: 6,
    });
    const lookup = agent.options.lookup as any;
    const all = jest.fn(),
      single = jest.fn();
    lookup('ignored.example', { all: true }, all);
    lookup('ignored.example', {}, single);
    expect(all).toHaveBeenCalledWith(null, [
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
    expect(single).toHaveBeenCalledWith(null, '2001:4860:4860::8888', 6);
    agent.destroy();
  });
  it('rejects relative and public storage paths, including Windows case variants', () => {
    const previous = process.env.MAILBOX_PRIVATE_DIR;
    try {
      process.env.MAILBOX_PRIVATE_DIR = 'relative-mail';
      expect(mailboxPrivateRoot).toThrow(
        'MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED',
      );
      process.env.MAILBOX_PRIVATE_DIR = resolve(
        __dirname,
        '../../../cronox-front/private-mail',
      );
      expect(mailboxPrivateRoot).toThrow(
        'MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED',
      );
      if (process.platform === 'win32') {
        process.env.MAILBOX_PRIVATE_DIR =
          process.env.MAILBOX_PRIVATE_DIR.toUpperCase();
        expect(mailboxPrivateRoot).toThrow(
          'MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED',
        );
      }
    } finally {
      if (previous === undefined) delete process.env.MAILBOX_PRIVATE_DIR;
      else process.env.MAILBOX_PRIVATE_DIR = previous;
    }
  });
  it('preserves safe configuration codes without leaking provider error details', () => {
    expect(
      safeError(new ServiceUnavailableException('MAILBOX_CREDENTIAL_MISSING')),
    ).toBe('MAILBOX_CREDENTIAL_MISSING');
    expect(safeError(new Error('private provider transcript'))).toBe(
      'CONNECTION_FAILED',
    );
  });
  beforeEach(() => {
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'unit';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({
      unit: Buffer.alloc(32, 7).toString('base64'),
    });
  });
  afterEach(() => {
    delete process.env.MAILBOX_ENCRYPTION_KEY_ID;
    delete process.env.MAILBOX_ENCRYPTION_KEYS;
  });
  it('authenticates encrypted secrets, binds mailbox and supports old key IDs', () => {
    const value = encrypt('only-a-synthetic-test-value', 'box:imap');
    expect(value).not.toContain('synthetic');
    expect(decrypt(value, 'box:imap')).toBe('only-a-synthetic-test-value');
    expect(() => decrypt(value, 'another:imap')).toThrow();
    const broken = value.slice(0, -4) + 'AAAA';
    expect(() => decrypt(broken, 'box:imap')).toThrow();
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'next';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({
      unit: Buffer.alloc(32, 7).toString('base64'),
      next: Buffer.alloc(32, 8).toString('base64'),
    });
    expect(decrypt(value, 'box:imap')).toBe('only-a-synthetic-test-value');
  });
  it('has no fallback encryption key', () => {
    delete process.env.MAILBOX_ENCRYPTION_KEYS;
    expect(keyring).toThrow('MAILBOX_ENCRYPTION_NOT_CONFIGURED');
  });
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
    '192.0.0.1',
    '224.0.0.1',
  ])('rejects nonpublic address %s', (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it('rejects mixed public/private DNS answers and pins only public resolution', async () => {
    await expect(
      resolvePublic(
        'imap.hostinger.com',
        jest.fn().mockResolvedValue([
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
      ),
    ).rejects.toThrow('MAILBOX_UNSAFE_DNS');
    expect(
      await resolvePublic(
        'imap.hostinger.com',
        jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
      ),
    ).toEqual({ address: '8.8.8.8', family: 4 });
  });
  it('allows only official servers and encrypted ports', () => {
    expect(() =>
      serverConfig({
        provider: 'hostinger',
        imapHost: 'imap.hostinger.com',
        imapPort: 993,
        smtpHost: 'smtp.hostinger.com',
        smtpPort: 587,
      }),
    ).not.toThrow();
    expect(() =>
      serverConfig({
        provider: 'hostinger',
        imapHost: '127.0.0.1',
        imapPort: 993,
        smtpHost: 'smtp.hostinger.com',
        smtpPort: 465,
      }),
    ).toThrow();
    expect(() =>
      serverConfig({
        provider: 'hostinger',
        imapHost: 'imap.hostinger.com',
        imapPort: 143,
        smtpHost: 'smtp.hostinger.com',
        smtpPort: 25,
      }),
    ).toThrow();
  });
  it('rejects header injection and deduplicates validated recipients', () => {
    expect(() =>
      addresses('good@example.test\r\nBcc:evil@example.test'),
    ).toThrow();
    expect(() => addresses('a@example.test, bad')).toThrow();
    for (const malformed of [
      'a(comment)@example.test',
      'a@example.test(comment)',
      'a@bad_domain.test',
      '.a@example.test',
      'a..b@example.test',
    ])
      expect(() => addresses(malformed)).toThrow();
    expect(addresses('A@example.test; a@example.test')).toEqual([
      'a@example.test',
    ]);
  });
  it('reply-all uses Reply-To, excludes own address/duplicates and never exposes bcc', () => {
    expect(
      replyRecipients(
        {
          from: [{ address: 'from@example.test' }],
          replyTo: [{ address: 'reply@example.test' }],
          to: [
            { address: 'own@example.test' },
            { address: 'reply@example.test' },
            { address: 'other@example.test' },
          ],
          cc: [
            { address: 'other@example.test' },
            { address: 'third@example.test' },
          ],
          bcc: [{ address: 'secret@example.test' }],
        },
        'own@example.test',
        true,
      ),
    ).toEqual({
      to: 'reply@example.test, other@example.test',
      cc: 'third@example.test',
    });
  });
  it('removes active HTML, forms, CSS tracking and dangerous links', () => {
    const html =
      '<script>alert(1)</script><form><input></form><img src="https://tracker.example/x"><div style="background:url(https://tracker.example)">ok</div><a href="javascript:alert(1)" onclick="x()">x</a><a href="https://example.test">safe</a>';
    expect(safeHtml(html)).not.toMatch(
      /<script|<form|<input|<img|style=|onclick|javascript:/,
    );
    expect(safeHtml(html)).toContain('noopener noreferrer');
    expect(safeHtml(html, true)).toContain('https://tracker.example/x');
    expect(messageDocument(html)).toContain("img-src 'none'");
  });
  it('normalizes filenames without allowing paths or header injection', () => {
    expect(safeFilename('../../hello\r\n.pdf')).not.toMatch(/[\/\r\n]/);
  });
  it.each([
    { code: 'EAUTH' },
    { code: 'EENVELOPE' },
    { code: 'ECONNREFUSED' },
    { responseCode: 550 },
  ])('known SMTP rejection does not become uncertain (%j)', (error) =>
    expect(smtpOutcome(error)).toBe('FAILED'),
  );
  it('never retries ambiguous SMTP outcomes after DATA/timeouts/process loss', () => {
    expect(smtpOutcome({ code: 'ETIMEDOUT', command: 'DATA' })).toBe('UNKNOWN');
    expect(smtpOutcome({ code: 'ECONNRESET' })).toBe('UNKNOWN');
    expect(smtpOutcome({ code: 'ECONNECTION', command: 'DATA' })).toBe(
      'UNKNOWN',
    );
    expect(smtpOutcome({}, false)).toBe('FAILED');
  });
  it('rejects arbitrary push endpoints and local addresses', () => {
    expect(() => pushHost('https://127.0.0.1/')).toThrow();
    expect(() => pushHost('https://fcm.googleapis.com.evil.test/')).toThrow();
    expect(() => pushHost('https://u:p@fcm.googleapis.com/')).toThrow();
    expect(pushHost('https://web.push.apple.com/test')).toBe(
      'web.push.apple.com',
    );
  });
  it('ADMIN has no automatic access and USER cannot query mail', async () => {
    const db: any = { mailbox: { findMany: jest.fn().mockResolvedValue([]) } };
    const access = new MailboxAccessService(db);
    await expect(access.box({ id: 1, role: 'ADMIN' }, 'other')).rejects.toThrow(
      'MAILBOX_ACCESS_DENIED',
    );
    await expect(access.allowedIds({ id: 1, role: 'USER' })).rejects.toThrow();
    expect(db.mailbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { permissions: { some: { userId: 1 } } },
      }),
    );
  });
  it('a disabled worker does not connect, query the DB or send at boot', () => {
    delete process.env.MAILBOX_WORKER_ENABLED;
    const db: any = { mailbox: { findMany: jest.fn() } },
      sender: any = { process: jest.fn() },
      sync: any = { sync: jest.fn() };
    const worker = new MailboxWorkerService(
      db,
      sync,
      sender,
      {} as any,
      {} as any,
    );
    worker.onModuleInit();
    expect(db.mailbox.findMany).not.toHaveBeenCalled();
    expect(sync.sync).not.toHaveBeenCalled();
    expect(sender.process).not.toHaveBeenCalled();
  });
});
