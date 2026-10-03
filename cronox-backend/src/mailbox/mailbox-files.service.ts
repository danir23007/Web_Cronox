import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  realpathSync,
} from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import {
  resolve,
  join,
  isAbsolute,
  dirname,
  basename,
  relative,
} from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { keyring } from './mailbox-security';

export function mailboxPrivateRoot() {
  const configured = process.env.MAILBOX_PRIVATE_DIR;
  if (!configured || !isAbsolute(configured))
    throw new ServiceUnavailableException(
      'MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED',
    );
  const canonical = (value: string): string => {
    if (existsSync(value)) return realpathSync(value);
    return join(canonical(dirname(value)), basename(value));
  };
  const root = canonical(resolve(configured));
  const publicRoot = canonical(resolve(__dirname, '../../../cronox-front'));
  const relation = relative(publicRoot, root);
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation)))
    throw new ServiceUnavailableException(
      'MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED',
    );
  return root;
}

@Injectable()
export class MailboxFilesService {
  root() {
    return mailboxPrivateRoot();
  }
  async write(source: Readable, maximum: number) {
    const root = this.root(),
      key = randomUUID(),
      { id, key: secret } = keyring(),
      iv = randomBytes(12);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const cipher = createCipheriv('aes-256-gcm', secret, iv);
    cipher.setAAD(Buffer.from(key));
    let size = 0;
    const bound = new Transform({
      transform(chunk, _enc, done) {
        size += chunk.length;
        done(
          size > maximum
            ? Object.assign(new Error('LIMIT_EXCEEDED'), {
                code: 'LIMIT_EXCEEDED',
              })
            : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        source,
        bound,
        cipher,
        createWriteStream(join(root, key), { flags: 'wx', mode: 0o600 }),
      );
      await writeFile(
        join(root, key + '.meta'),
        JSON.stringify({
          id,
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
        }),
        { mode: 0o600, flag: 'wx' },
      );
      return { key, size };
    } catch (e) {
      await this.remove(key);
      throw e;
    }
  }
  async read(key: string) {
    if (!/^[\da-f-]{36}$/.test(key))
      throw new ServiceUnavailableException('MAILBOX_FILE_UNAVAILABLE');
    const root = this.root(),
      meta = JSON.parse(await readFile(join(root, key + '.meta'), 'utf8')),
      secret = Buffer.from(keyring().keys[meta.id] || '', 'base64');
    if (secret.length !== 32)
      throw new ServiceUnavailableException('MAILBOX_KEY_UNAVAILABLE');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      secret,
      Buffer.from(meta.iv, 'base64'),
    );
    cipher.setAAD(Buffer.from(key));
    cipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
    const source = createReadStream(join(root, key));
    source.on('error', (error) => cipher.destroy(error));
    return source.pipe(cipher);
  }
  async remove(key: string) {
    if (!/^[\da-f-]{36}$/.test(key)) return;
    await Promise.all([
      unlink(join(this.root(), key)).catch(() => {}),
      unlink(join(this.root(), key + '.meta')).catch(() => {}),
    ]);
  }
}
