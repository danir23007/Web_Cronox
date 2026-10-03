import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export type MailActor = { id: number; role: string };
@Injectable()
export class MailboxAccessService {
  constructor(readonly db: PrismaService) {}
  superadmin(actor: MailActor) {
    if (actor.role !== 'SUPERADMIN')
      throw new ForbiddenException('MAILBOX_SUPERADMIN_REQUIRED');
  }
  async allowedIds(actor: MailActor, send = false) {
    if (!['ADMIN', 'SUPERADMIN'].includes(actor.role))
      throw new ForbiddenException('MAILBOX_ACCESS_DENIED');
    return (
      await this.db.mailbox.findMany({
        where:
          actor.role === 'SUPERADMIN'
            ? {}
            : {
                permissions: {
                  some: {
                    userId: actor.id,
                    ...(send ? { access: 'send' } : {}),
                  },
                },
              },
        select: { id: true },
      })
    ).map((b) => b.id);
  }
  async box(actor: MailActor, id: string, send = false) {
    if (!(await this.allowedIds(actor, send)).includes(id))
      throw new ForbiddenException('MAILBOX_ACCESS_DENIED');
    const box = await this.db.mailbox.findUnique({ where: { id } });
    if (!box) throw new NotFoundException('MAILBOX_NOT_FOUND');
    return box;
  }
  async message(actor: MailActor, id: string) {
    const msg = await this.db.mailboxMessage.findUnique({
      where: { id },
      include: { folder: true, mailbox: true, files: true },
    });
    if (!msg) throw new NotFoundException('MAILBOX_MESSAGE_NOT_FOUND');
    await this.box(actor, msg.mailboxId);
    if (
      !msg.alive ||
      !msg.folder.available ||
      msg.uidValidity !== msg.folder.uidValidity
    )
      throw new NotFoundException('MAILBOX_MESSAGE_UNAVAILABLE');
    return msg;
  }
  async draft(actor: MailActor, id: string) {
    const draft = await this.db.mailboxDraft.findUnique({
      where: { id },
      include: {
        files: true,
        mailbox: true,
        sends: { orderBy: { createdAt: 'desc' } },
        campaigns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!draft) throw new NotFoundException('MAILBOX_DRAFT_NOT_FOUND');
    await this.box(actor, draft.mailboxId, true);
    if (draft.userId !== actor.id)
      throw new ForbiddenException('MAILBOX_DRAFT_OWNER_REQUIRED');
    return draft;
  }
  async audit(
    actor: MailActor | null,
    box: string | null,
    action: string,
    id: string | null,
    outcome = 'OK',
  ) {
    await this.db.mailboxAudit.create({
      data: {
        userId: actor?.id,
        mailboxId: box,
        action,
        objectId: id,
        outcome,
      },
    });
  }
}
