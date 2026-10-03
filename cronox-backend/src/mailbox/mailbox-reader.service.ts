import { BadRequestException, Injectable } from '@nestjs/common';
import { MailParser, simpleParser } from 'mailparser';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxAccessService, MailActor } from './mailbox-access.service';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { MailboxProviderService } from './mailbox-provider.service';
import {
  maxMessageBytes,
  maxAttachmentBytes,
  safeFilename,
  safeHtml,
  replyChoices,
  safeError,
} from './mailbox-security';

@Injectable()
export class MailboxReaderService {
  constructor(
    readonly db: PrismaService,
    readonly access: MailboxAccessService,
    readonly files: MailboxFilesService,
    readonly leases: MailboxLeasesService,
    readonly provider: MailboxProviderService,
  ) {}
  // Internal worker cache only: no user/session is created, no seen flag is changed.
  cacheSystem(id: string) {
    return this.body({ id: 0, role: 'SUPERADMIN' }, id, false);
  }
  async body(actor: MailActor, id: string, interactive = true, repair = true) {
    const msg = await this.access.message(actor, id);
    if (!msg.bodyKey && !msg.mailbox.active)
      throw new BadRequestException('MAILBOX_INACTIVE_CACHED_ONLY');
    if (!msg.bodyKey) {
      try {
        await this.leases.run(
          msg.mailboxId,
          async (token, assert) => {
            const current = await this.access.message(actor, id);
            if (current.bodyKey) return;
            if (!current.mailbox.active)
              throw new BadRequestException('MAILBOX_INACTIVE_CACHED_ONLY');
            let client:
              | Awaited<ReturnType<MailboxProviderService['imap']>>
              | undefined;
            const created: {
              key: string;
              size: number;
              name: string;
              mimeType: string;
            }[] = [];
            let bodyKey: string | undefined;
            try {
              client = await this.provider.imap(current.mailbox);
              await assert();
              await this.access.box(actor, current.mailboxId);
              const lock = await client.getMailboxLock(current.folder.path, {
                readOnly: true,
              });
              try {
                if (
                  String((client.mailbox as any).uidValidity) !==
                  current.uidValidity
                )
                  throw new BadRequestException('MAILBOX_UIDVALIDITY_CHANGED');
                const metadata = await client.fetchOne(
                  String(current.uid),
                  { headers: true, bodyStructure: true },
                  { uid: true },
                );
                if (!metadata) {
                  await this.leases.commit(current.mailboxId, token, (tx) =>
                    tx.mailboxMessage.update({
                      where: { id },
                      data: { alive: false },
                    }),
                  );
                  throw new BadRequestException('MAILBOX_MESSAGE_UNAVAILABLE');
                }
                if ((metadata.headers?.length || 0) > 256000)
                  throw new BadRequestException('MAILBOX_HEADERS_TOO_LARGE');
                const headers = await simpleParser(
                  metadata.headers || Buffer.alloc(0),
                );
                const parts: any[] = [];
                const walk = (node: any) => {
                  if (!node) return;
                  if (
                    node.disposition === 'attachment' ||
                    node.type === 'message/rfc822'
                  ) {
                    parts.push(node);
                    return;
                  }
                  if (node.childNodes?.length) node.childNodes.forEach(walk);
                  else parts.push(node);
                };
                walk(metadata.bodyStructure);
                const parsed = {
                  text: '',
                  html: '',
                  references: (Array.isArray(headers.references)
                    ? headers.references
                    : headers.references
                      ? [headers.references]
                      : []
                  )
                    .filter((r) => /^<[^<>\r\n]{1,200}>$/.test(r))
                    .slice(-50),
                  inReplyTo: headers.inReplyTo,
                };
                for (const kind of ['text/plain', 'text/html']) {
                  const part = parts.find(
                    (p) => p.type === kind && p.disposition !== 'attachment',
                  );
                  if (!part) continue;
                  const maximum = Math.min(maxMessageBytes(), 2000000);
                  if (part.size > maximum)
                    throw new BadRequestException(
                      'MAILBOX_CONTENT_TOO_LARGE_USE_WEBMAIL',
                    );
                  const downloaded = await client.download(
                    String(current.uid),
                    part.part || '1',
                    { uid: true, maxBytes: maximum + 1 },
                  );
                  if (!downloaded.content)
                    throw new BadRequestException(
                      'MAILBOX_CONTENT_DOWNLOAD_FAILED',
                    );
                  const buffer = await this.buffer(downloaded.content, maximum);
                  const charset = String(
                    downloaded.meta?.charset || 'utf-8',
                  ).replace(/[^\w-]/g, '');
                  const mime = await simpleParser(
                    Buffer.concat([
                      Buffer.from(
                        `Content-Type: ${kind}; charset=${charset}\r\n\r\n`,
                      ),
                      buffer,
                    ]),
                    { skipHtmlToText: true, skipTextToHtml: true },
                  );
                  if (kind === 'text/plain') parsed.text = mime.text || '';
                  else parsed.html = safeHtml(String(mime.html || ''), true);
                }
                const attachments = parts
                  .filter(
                    (p) =>
                      p.disposition === 'attachment' ||
                      !['text/plain', 'text/html'].includes(p.type),
                  )
                  .slice(0, 100)
                  .map((p) => ({
                    mailboxId: current.mailboxId,
                    messageId: id,
                    imapPart: p.part || '1',
                    name: safeFilename(
                      p.dispositionParameters?.filename ||
                        p.parameters?.name ||
                        'attachment',
                    ),
                    mimeType: String(
                      p.type || 'application/octet-stream',
                    ).slice(0, 100),
                    size: Math.min(Number(p.size) || 0, 2147483647),
                  }));
                bodyKey = (
                  await this.files.write(
                    Readable.from(JSON.stringify(parsed)),
                    maxMessageBytes(),
                  )
                ).key;
                await assert();
                await this.access.box(actor, current.mailboxId);
                await this.leases.commit(
                  current.mailboxId,
                  token,
                  async (tx) => {
                    await tx.mailboxMessage.update({
                      where: { id },
                      data: {
                        bodyKey,
                        bodyState: 'LOADED',
                        preview: parsed.text.replace(/\s+/g, ' ').slice(0, 180),
                        hasAttachments: attachments.length > 0,
                      },
                    });
                    for (const file of attachments) {
                      const existing = await tx.mailboxFile.findFirst({
                        where: { messageId: id, imapPart: file.imapPart },
                      });
                      if (existing)
                        await tx.mailboxFile.update({
                          where: { id: existing.id },
                          data: file,
                        });
                      else await tx.mailboxFile.create({ data: file });
                    }
                  },
                );
              } finally {
                lock.release();
              }
            } catch (e) {
              await Promise.all(created.map((f) => this.files.remove(f.key)));
              if (bodyKey) await this.files.remove(bodyKey);
              throw e;
            } finally {
              if (client) await client.logout().catch(() => client!.close());
            }
          },
          { waitMs: interactive ? 30000 : 0 },
        );
      } catch (error) {
        const code = safeError(error);
        if (!['MAILBOX_BUSY', 'MAILBOX_LEASE_LOST'].includes(code)) {
          await this.db.mailboxMessage.updateMany({
            where: { id, bodyKey: null, alive: true },
            data: { bodyState: 'FAILED' },
          });
          await this.access.audit(
            actor.id ? actor : null,
            msg.mailboxId,
            'body-download',
            id,
            code,
          );
        }
        throw error;
      }
    }
    const current = await this.access.message(actor, id);
    const chunks: Buffer[] = [];
    let size = 0;
    let body: any;
    try {
      for await (const chunk of await this.files.read(current.bodyKey!)) {
        size += chunk.length;
        if (size > maxMessageBytes())
          throw new BadRequestException(
            'MAILBOX_CONTENT_TOO_LARGE_USE_WEBMAIL',
          );
        chunks.push(chunk as Buffer);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body?.text !== 'string' || typeof body?.html !== 'string')
        throw new BadRequestException('MAILBOX_CACHED_CONTENT_UNAVAILABLE');
    } catch (error) {
      if (repair && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.db.mailboxMessage.updateMany({
          where: { id, bodyKey: current.bodyKey },
          data: { bodyKey: null, bodyState: 'NOT_LOADED' },
        });
        return this.body(actor, id, interactive, false);
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('MAILBOX_CACHED_CONTENT_UNAVAILABLE');
    }
    await this.access.box(actor, current.mailboxId);
    return {
      ...this.view(current),
      body,
    };
  }
  async buffer(source: Readable, maximum: number) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of source) {
      size += chunk.length;
      if (size > maximum) {
        source.destroy();
        throw new BadRequestException('MAILBOX_CONTENT_TOO_LARGE_USE_WEBMAIL');
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }
  async file(actor: MailActor, id: string) {
    let file = await this.db.mailboxFile.findUniqueOrThrow({ where: { id } });
    await this.access.box(actor, file.mailboxId);
    if (file.draftId) await this.access.draft(actor, file.draftId);
    else if (file.messageId) await this.access.message(actor, file.messageId);
    else throw new BadRequestException('MAILBOX_FILE_UNAVAILABLE');
    if (!file.key && file.messageId && file.imapPart) {
      const msg = await this.access.message(actor, file.messageId);
      if (!msg.mailbox.active)
        throw new BadRequestException('MAILBOX_INACTIVE_CACHED_ONLY');
      if (file.size > maxAttachmentBytes())
        throw new BadRequestException(
          'MAILBOX_ATTACHMENT_TOO_LARGE_USE_WEBMAIL',
        );
      await this.leases.interactive(file.mailboxId, async (token, assert) => {
        const msg = await this.access.message(actor, file.messageId!);
        if (!msg.mailbox.active)
          throw new BadRequestException('MAILBOX_INACTIVE_CACHED_ONLY');
        const current = await this.db.mailboxFile.findUniqueOrThrow({
          where: { id },
        });
        if (current.key) return;
        const client = await this.provider.imap(msg.mailbox);
        let key: string | undefined;
        try {
          await assert();
          await this.access.message(actor, msg.id);
          const lock = await client.getMailboxLock(msg.folder.path, {
            readOnly: true,
          });
          try {
            if (String((client.mailbox as any).uidValidity) !== msg.uidValidity)
              throw new BadRequestException('MAILBOX_UIDVALIDITY_CHANGED');
            const source = await client.download(
              String(msg.uid),
              current.imapPart!,
              { uid: true, maxBytes: maxAttachmentBytes() + 1 },
            );
            if (!source.content)
              throw new BadRequestException('MAILBOX_FILE_UNAVAILABLE');
            const saved = await this.files.write(
              source.content,
              maxAttachmentBytes(),
            );
            key = saved.key;
            await assert();
            await this.access.message(actor, msg.id);
            await this.leases.commit(file.mailboxId, token, (tx) =>
              tx.mailboxFile.update({ where: { id }, data: saved }),
            );
          } finally {
            lock.release();
          }
        } catch (e) {
          if (key) await this.files.remove(key);
          throw e;
        } finally {
          await client.logout().catch(() => client.close());
        }
      });
      file = await this.db.mailboxFile.findUniqueOrThrow({ where: { id } });
    }
    if (!file.key) throw new BadRequestException('MAILBOX_FILE_UNAVAILABLE');
    return { ...file, stream: await this.files.read(file.key) };
  }
  async parse(
    source: Readable,
    created: { key: string; size: number; name: string; mimeType: string }[],
  ) {
    const parser = new MailParser({
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
      maxHtmlLengthToParse: 2000000,
    });
    let bytes = 0,
      text = '',
      html = '',
      references: string[] = [],
      inReplyTo: string | undefined;
    const tasks: Promise<void>[] = [];
    parser.on('headers', (headers) => {
      const refs = headers.get('references');
      references = (
        Array.isArray(refs) ? refs : typeof refs === 'string' ? [refs] : []
      )
        .filter(
          (x): x is string =>
            typeof x === 'string' && /^<[^<>\r\n]{1,200}>$/.test(x),
        )
        .slice(-50);
      const reply = headers.get('in-reply-to');
      if (typeof reply === 'string' && /^<[^<>\r\n]{1,200}>$/.test(reply))
        inReplyTo = reply;
    });
    parser.on('data', (part) => {
      if (part.type === 'text') {
        text = String(part.text || '').slice(0, 2000000);
        html = safeHtml(String(part.html || ''), true);
      } else {
        const task = (async () => {
          try {
            const file = await this.files.write(
              part.content,
              maxAttachmentBytes(),
            );
            created.push({
              ...file,
              name: safeFilename(part.filename || 'attachment'),
              mimeType: String(
                part.contentType || 'application/octet-stream',
              ).slice(0, 100),
            });
          } finally {
            part.release();
          }
        })();
        tasks.push(task);
        void task.catch(() =>
          parser.destroy(
            Object.assign(new Error('LIMIT_EXCEEDED'), {
              code: 'LIMIT_EXCEEDED',
            }),
          ),
        );
      }
    });
    const bound = new Transform({
      transform(chunk, _enc, done) {
        bytes += chunk.length;
        done(
          bytes > maxMessageBytes()
            ? Object.assign(new Error('LIMIT_EXCEEDED'), {
                code: 'LIMIT_EXCEEDED',
              })
            : null,
          chunk,
        );
      },
    });
    let failure: unknown;
    try {
      await pipeline(source, bound, parser);
    } catch (e) {
      failure = e;
    }
    const outcomes = await Promise.allSettled(tasks);
    if (failure) throw failure;
    const failed = outcomes.find((o) => o.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return { text, html, references, inReplyTo };
  }
  view(msg: any) {
    return {
      id: msg.id,
      mailboxId: msg.mailboxId,
      folderId: msg.folderId,
      subject: msg.subject,
      sender: msg.sender,
      recipients: msg.recipients,
      envelope: msg.envelope,
      replyChoices: replyChoices(msg.envelope),
      date: msg.date,
      size: msg.size,
      seen: msg.seen,
      hasAttachments: msg.hasAttachments,
      preview: msg.preview,
      bodyState: msg.bodyState,
      files: (msg.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
      })),
    };
  }
  async action(
    actor: MailActor,
    id: string,
    operation: string,
    destination?: string,
  ) {
    const initial = await this.access.message(actor, id);
    if (!initial.mailbox.active)
      throw new BadRequestException('MAILBOX_INACTIVE');
    if (operation === 'trash' || operation === 'restore')
      await this.access.box(actor, initial.mailboxId, true);
    return this.leases.interactive(initial.mailboxId, async (token, assert) => {
      const msg = await this.access.message(actor, id);
      if (!msg.mailbox.active)
        throw new BadRequestException('MAILBOX_INACTIVE');
      const client = await this.provider.imap(msg.mailbox);
      try {
        await assert();
        await this.access.box(
          actor,
          msg.mailboxId,
          operation === 'trash' || operation === 'restore',
        );
        const lock = await client.getMailboxLock(msg.folder.path);
        try {
          if (String((client.mailbox as any).uidValidity) !== msg.uidValidity)
            throw new BadRequestException('MAILBOX_UIDVALIDITY_CHANGED');
          const before = await client.fetchOne(
            String(msg.uid),
            { flags: true },
            { uid: true },
          );
          if (!before)
            throw new BadRequestException('MAILBOX_MESSAGE_UNAVAILABLE');
          if (operation === 'read' || operation === 'unread') {
            const ok = await (operation === 'read'
              ? client.messageFlagsAdd(String(msg.uid), ['\\Seen'], {
                  uid: true,
                })
              : client.messageFlagsRemove(String(msg.uid), ['\\Seen'], {
                  uid: true,
                }));
            if (!ok)
              throw new BadRequestException('MAILBOX_OPERATION_NOT_SUPPORTED');
            const confirmed = await client.fetchOne(
              String(msg.uid),
              { flags: true },
              { uid: true },
            );
            if (!confirmed)
              throw new BadRequestException('MAILBOX_MESSAGE_UNAVAILABLE');
            const flags = confirmed.flags;
            if (!flags || flags.has('\\Seen') !== (operation === 'read'))
              throw new BadRequestException('MAILBOX_READ_STATE_NOT_CONFIRMED');
            await this.leases.commit(msg.mailboxId, token, (tx) =>
              tx.mailboxMessage.update({
                where: { id },
                data: {
                  seen: operation === 'read',
                  flags: [...flags],
                },
              }),
            );
          } else if (operation === 'trash' || operation === 'restore') {
            if (!client.capabilities.has('MOVE'))
              throw new BadRequestException('MAILBOX_MOVE_NOT_SUPPORTED');
            const folders = await this.db.mailboxFolder.findMany({
              where: { mailboxId: msg.mailboxId, available: true },
            });
            const target =
              operation === 'trash'
                ? folders.find((f) => f.specialUse === '\\Trash') ||
                  folders.find(
                    (f) =>
                      !f.specialUse &&
                      /^(?:INBOX[./])?(?:Trash|Deleted Items|Deleted Messages)$/i.test(
                        f.path,
                      ),
                  )
                : destination
                  ? folders.find((f) => f.id === destination)
                  : folders.find((f) => f.specialUse === '\\Inbox') ||
                    folders.find((f) => f.path.toUpperCase() === 'INBOX');
            if (!target || target.id === msg.folderId)
              throw new BadRequestException(
                'MAILBOX_DESTINATION_NOT_AVAILABLE',
              );
            const moved = await client.messageMove(
              String(msg.uid),
              target.path,
              { uid: true },
            );
            if (!moved)
              throw new BadRequestException('MAILBOX_OPERATION_NOT_SUPPORTED');
            const destinationUid =
              moved.uidMap?.get(msg.uid as unknown as number) ||
              moved.uidMap?.get(Number(msg.uid));
            await this.leases.commit(msg.mailboxId, token, async (tx) => {
              await tx.mailboxMessage.update({
                where: { id },
                data:
                  destinationUid && moved.uidValidity
                    ? {
                        folderId: target.id,
                        uid: BigInt(destinationUid),
                        uidValidity: String(moved.uidValidity),
                      }
                    : { alive: false },
              });
              await tx.mailbox.update({
                where: { id: msg.mailboxId },
                data: { nextSyncAt: new Date() },
              });
            });
          } else throw new BadRequestException('MAILBOX_INVALID_OPERATION');
          await this.access.audit(actor, msg.mailboxId, operation, id);
          await this.access.box(actor, msg.mailboxId);
          return { ok: true };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => client.close());
      }
    });
  }
}
