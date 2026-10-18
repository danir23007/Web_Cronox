import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import {
  MailboxFilesService,
  mailboxStorageError,
} from './mailbox-files.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { safeError } from './mailbox-security';

const fs = require('node:fs');
const storage = require('node:fs/promises');
const denied = () =>
  Object.assign(new Error('EACCES: private fixture path'), { code: 'EACCES' });
const code = 'MAILBOX_PRIVATE_STORAGE_PERMISSION_DENIED';

describe('Private mailbox storage failure recovery', () => {
  let root: string;
  let files: MailboxFilesService;
  let previous: Record<string, string | undefined>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cronox-mail-reader-'));
    previous = Object.fromEntries(
      [
        'MAILBOX_PRIVATE_DIR',
        'MAILBOX_ENCRYPTION_KEY_ID',
        'MAILBOX_ENCRYPTION_KEYS',
      ].map((name) => [name, process.env[name]]),
    );
    process.env.MAILBOX_PRIVATE_DIR = root;
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'fixture';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({
      fixture: Buffer.alloc(32, 5).toString('base64'),
    });
    files = new MailboxFilesService();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  const content = async (source: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  };

  it.each(['EACCES', 'EPERM'])(
    'reports %s with a safe storage diagnostic, without exposing a filesystem path',
    async (errno) => {
      jest
        .spyOn(storage, 'mkdir')
        .mockRejectedValueOnce(Object.assign(denied(), { code: errno }));
      await expect(
        files.write(Readable.from('private test content'), 1000),
      ).rejects.toThrow(code);
      expect(safeError(mailboxStorageError(denied()))).toBe(code);
      expect(mailboxStorageError(denied()).message).not.toContain(
        'fixture path',
      );
    },
  );

  it('preserves encrypted cache when metadata access is denied and reads it after permissions recover', async () => {
    const saved = await files.write(Readable.from('café y conexión'), 1000);
    const original = await readFile(join(root, saved.key));
    jest.spyOn(storage, 'readFile').mockRejectedValueOnce(denied());
    await expect(files.read(saved.key)).rejects.toThrow(code);
    expect(await content(await files.read(saved.key))).toBe('café y conexión');
    expect(await readFile(join(root, saved.key))).toEqual(original);
  });

  it('classifies asynchronous ciphertext permission failures too', async () => {
    const saved = await files.write(Readable.from('synthetic'), 1000);
    jest.spyOn(fs, 'createReadStream').mockImplementationOnce(() => {
      const stream = new PassThrough();
      queueMicrotask(() => stream.destroy(denied()));
      return stream;
    });
    await expect(content(await files.read(saved.key))).rejects.toThrow(code);
  });

  function fixture() {
    const msg: any = {
      id: 'message',
      mailboxId: 'box',
      uid: 7n,
      uidValidity: '101',
      alive: true,
      bodyKey: null,
      bodyState: 'NOT_LOADED',
      seen: false,
      mailbox: { id: 'box', active: true },
      folder: { path: 'INBOX', available: true, uidValidity: '101' },
    };
    const attachments: any[] = [];
    const db: any = {
      mailboxMessage: {
        update: jest.fn(async ({ data }) => Object.assign(msg, data)),
        updateMany: jest.fn(async ({ where, data }) => {
          if (where.bodyKey !== undefined && where.bodyKey !== msg.bodyKey)
            return { count: 0 };
          Object.assign(msg, data);
          return { count: 1 };
        }),
      },
      mailboxFile: {
        findFirst: jest.fn(async ({ where }) =>
          attachments.find((file) => file.imapPart === where.imapPart),
        ),
        create: jest.fn(async ({ data }) => {
          const file = { id: 'attachment', ...data };
          attachments.push(file);
          return file;
        }),
        update: jest.fn(async ({ where, data }) =>
          Object.assign(
            attachments.find((file) => file.id === where.id),
            data,
          ),
        ),
      },
    };
    const access: any = {
      message: jest.fn(async () => ({ ...msg, files: attachments })),
      box: jest.fn(async () => msg.mailbox),
      audit: jest.fn(),
    };
    const client = {
      mailbox: { uidValidity: 101n },
      getMailboxLock: jest.fn(async () => ({ release: jest.fn() })),
      fetchOne: jest.fn(async () => ({
        headers: Buffer.from(
          'Content-Type: multipart/mixed; boundary=fixture\r\n\r\n',
        ),
        bodyStructure: {
          type: 'multipart/mixed',
          childNodes: [
            { part: '1', type: 'text/plain', size: 100 },
            { part: '2', type: 'text/html', size: 100 },
            {
              part: '3',
              type: 'application/pdf',
              disposition: 'attachment',
              size: 10,
              dispositionParameters: { filename: 'prueba.pdf' },
            },
          ],
        },
      })),
      download: jest.fn(async (_uid, part) => ({
        meta: { charset: 'utf-8' },
        content: Readable.from(
          Buffer.from(
            part === '1'
              ? 'Café, conexión y ñ'
              : '<p>Café</p><script>malicious()</script><a href="javascript:malicious()">link</a>',
          ),
        ),
      })),
      logout: jest.fn(),
      close: jest.fn(),
    };
    client.logout.mockResolvedValue(undefined);
    const provider: any = { imap: jest.fn(async () => client) };
    const leases: any = {
      run: jest.fn(async (_id, work) => work('token', async () => {})),
      commit: jest.fn(async (_id, _token, work) => work(db)),
    };
    const reader = new MailboxReaderService(
      db,
      access,
      files,
      leases,
      provider,
    );
    return { msg, db, access, provider, client, reader, attachments };
  }
  const actor = { id: 1, role: 'SUPERADMIN' };

  it('retries a FAILED body after storage is repaired, retaining UID, HTML isolation and one attachment entry', async () => {
    const f = fixture();
    jest.spyOn(storage, 'mkdir').mockRejectedValueOnce(denied());
    await expect(f.reader.body(actor, 'message')).rejects.toThrow(code);
    expect(f.msg.bodyState).toBe('FAILED');
    expect(f.msg.bodyKey).toBeNull();
    expect(f.access.audit).toHaveBeenCalledWith(
      actor,
      'box',
      'body-download',
      'message',
      code,
    );

    const recovered = await f.reader.body(actor, 'message');
    expect(recovered.body.text).toBe('Café, conexión y ñ');
    expect(recovered.body.html).toContain('<p>Café</p>');
    expect(recovered.body.html).not.toMatch(/<script|javascript:/);
    expect(f.client.fetchOne).toHaveBeenCalledWith('7', expect.anything(), {
      uid: true,
    });
    expect(f.client.getMailboxLock).toHaveBeenCalledWith('INBOX', {
      readOnly: true,
    });
    expect(f.msg.bodyState).toBe('LOADED');
    expect(f.msg.seen).toBe(false);
    expect(f.attachments).toHaveLength(1);
    await f.reader.body(actor, 'message');
    expect(f.attachments).toHaveLength(1);
    expect(f.provider.imap).toHaveBeenCalledTimes(2);
  });

  it('does not discard or redownload a cached body on access denial; a later open works without resetting data', async () => {
    const f = fixture();
    await f.reader.body(actor, 'message');
    const key = f.msg.bodyKey;
    jest.spyOn(storage, 'readFile').mockRejectedValueOnce(denied());
    await expect(f.reader.body(actor, 'message')).rejects.toThrow(code);
    expect(f.msg.bodyKey).toBe(key);
    expect(f.db.mailboxMessage.updateMany).not.toHaveBeenCalled();
    expect(f.access.audit).toHaveBeenCalledWith(
      actor,
      'box',
      'body-cache-read',
      'message',
      code,
    );
    expect((await f.reader.body(actor, 'message')).body.text).toBe(
      'Café, conexión y ñ',
    );
    expect(f.provider.imap).toHaveBeenCalledTimes(1);
  });

  it('repairs a missing cache once without duplicating attachments, but preserves references when a key is unavailable', async () => {
    const f = fixture();
    await f.reader.body(actor, 'message');
    const missing = f.msg.bodyKey;
    await files.remove(missing);
    await f.reader.body(actor, 'message');
    expect(f.msg.bodyKey).not.toBe(missing);
    expect(f.attachments).toHaveLength(1);
    const preserved = f.msg.bodyKey;
    jest
      .spyOn(files, 'read')
      .mockRejectedValueOnce(
        new ServiceUnavailableException('MAILBOX_KEY_UNAVAILABLE'),
      );
    await expect(f.reader.body(actor, 'message')).rejects.toThrow(
      'MAILBOX_KEY_UNAVAILABLE',
    );
    expect(f.msg.bodyKey).toBe(preserved);
    expect(f.provider.imap).toHaveBeenCalledTimes(2);
  });

  it('checks mailbox access before reading cached private content', async () => {
    const f = fixture();
    await f.reader.body(actor, 'message');
    const read = jest.spyOn(files, 'read');
    f.access.message.mockRejectedValueOnce(
      new ForbiddenException('MAILBOX_ACCESS_DENIED'),
    );
    await expect(
      f.reader.body({ id: 2, role: 'ADMIN' }, 'message'),
    ).rejects.toThrow('MAILBOX_ACCESS_DENIED');
    expect(read).not.toHaveBeenCalled();
  });
});
