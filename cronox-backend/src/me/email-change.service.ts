import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { EmailChangeRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializableTransaction } from '../prisma/serializable-transaction';
import { EmailService } from '../email/email.service';
import { getRequiredJwtSecret } from '../common/config/environment';
import { normalizeEmail } from '../common/email';

const TTL = 60 * 60_000;
const COOLDOWN = 60_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Action = 'authorize' | 'verify' | 'cancel';

@Injectable()
export class EmailChangeService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  private token(id: string, action: Action) {
    return createHmac('sha256', getRequiredJwtSecret('JWT_ACCESS_SECRET'))
      .update(`cronox-email-change:${id}:${action}`).digest('base64url');
  }

  private view(row: EmailChangeRequest | null) {
    if (!row) return { stage: 'NONE' };
    return { stage: row.expiresAt <= new Date() && !['COMPLETE', 'CANCELLED'].includes(row.stage)
      ? 'EXPIRED' : row.stage, newEmail: row.newEmail, expiresAt: row.expiresAt,
      delivery: row.delivery, resendAt: new Date(row.lastSentAt.getTime() + COOLDOWN), canResend: row.sendCount < 5 };
  }

  async status(userId: number) {
    return this.view(await this.prisma.emailChangeRequest.findUnique({ where: { userId } }));
  }

  async start(userId: number, address: string) {
    const newEmail = normalizeEmail(address);
    const result = await serializableTransaction(this.prisma, async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (newEmail === user.email) throw new BadRequestException('Introduce una dirección diferente.');
      if (await tx.user.findFirst({ where: { email: { equals: newEmail, mode: 'insensitive' } } }))
        throw new ConflictException('El email ya está en uso.');
      const previous = await tx.emailChangeRequest.findUnique({ where: { userId } });
      const now = new Date();
      if (previous && previous.newEmail === newEmail && previous.expiresAt > now &&
          ['PENDING_CURRENT', 'PENDING_NEW'].includes(previous.stage)) return { row: previous, send: false };
      if (previous && now.getTime() - previous.lastSentAt.getTime() < COOLDOWN)
        throw new HttpException('Espera un minuto antes de solicitar otro cambio.', 429);
      const sameWindow = previous && now.getTime() - previous.windowAt.getTime() < TTL;
      if (sameWindow && previous.starts >= 5) throw new HttpException('Demasiadas solicitudes. Vuelve a intentarlo más tarde.', 429);
      const id = randomUUID();
      const data = { id, oldEmail: user.email, newEmail, sessionVersion: user.sessionVersion,
        stage: 'PENDING_CURRENT', tokenHash: hash(this.token(id, 'authorize')), cancelHash: hash(this.token(id, 'cancel')),
        expiresAt: new Date(now.getTime() + TTL), lastSentAt: now, sendCount: 1, delivery: 'SENDING',
        windowAt: sameWindow ? previous.windowAt : now, starts: sameWindow ? previous.starts + 1 : 1, createdAt: now };
      const row = await tx.emailChangeRequest.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      return { row, send: true };
    }, true);
    if (result.send) await this.deliver(result.row);
    return this.status(userId);
  }

  private async deliver(row: EmailChangeRequest) {
    const authorize = row.stage === 'PENDING_CURRENT';
    const base = new URL('/email-change.html', process.env.FRONTEND_URL).href;
    const link = (action: Action) => `${base}#action=${action}&token=${this.token(row.id, action)}`;
    let accepted = false;
    try {
      await this.email.sendEmailChange(authorize ? row.oldEmail : row.newEmail, {
        authorize, newEmail: row.newEmail, actionUrl: link(authorize ? 'authorize' : 'verify'), cancelUrl: link('cancel'),
      });
      accepted = true;
      await this.prisma.emailChangeRequest.updateMany({ where: { id: row.id, stage: row.stage, lastSentAt: row.lastSentAt, delivery: 'SENDING' }, data: { delivery: 'SENT' } });
    } catch (error) {
      await this.prisma.emailChangeRequest.updateMany({ where: { id: row.id, stage: row.stage, lastSentAt: row.lastSentAt, delivery: 'SENDING' },
        data: { delivery: accepted || (error as { deliveryUnknown?: boolean }).deliveryUnknown ? 'UNKNOWN' : 'FAILED' } });
      throw new ServiceUnavailableException('No hemos podido confirmar el envío. La solicitud sigue pendiente; consulta su estado y reintenta el envío después de un minuto.');
    }
  }

  private async valid(tx: Prisma.TransactionClient | PrismaService, token: string, action: Action): Promise<EmailChangeRequest> {
    const digest = hash(token);
    const row = await tx.emailChangeRequest.findUnique({ where: action === 'cancel' ? { cancelHash: digest } : { tokenHash: digest } });
    if (!row || row.expiresAt <= new Date() || !['PENDING_CURRENT', 'PENDING_NEW'].includes(row.stage) ||
      (action === 'authorize' && row.stage !== 'PENDING_CURRENT') || (action === 'verify' && row.stage !== 'PENDING_NEW'))
      throw new BadRequestException('El enlace ha caducado, fue sustituido o ya se utilizó.');
    const user = await tx.user.findUnique({ where: { id: row.userId } });
    if (!user || user.email !== row.oldEmail || user.sessionVersion !== row.sessionVersion)
      throw new BadRequestException('La cuenta ha cambiado. Solicita un nuevo cambio de email.');
    return row;
  }

  async inspect(token: string, action: Action) {
    const row = await this.valid(this.prisma, token, action);
    return { action, newEmail: row.newEmail, expiresAt: row.expiresAt };
  }

  async confirm(token: string, action: Action) {
    let result: { row: EmailChangeRequest; send: boolean };
    try {
      result = await serializableTransaction(this.prisma, async tx => {
        const row = await this.valid(tx, token, action);
        if (action === 'cancel') return { row: await tx.emailChangeRequest.update({ where: { userId: row.userId }, data: { stage: 'CANCELLED' } }), send: false };
        if (action === 'authorize') return { row: await tx.emailChangeRequest.update({ where: { userId: row.userId },
          data: { stage: 'PENDING_NEW', tokenHash: hash(this.token(row.id, 'verify')), delivery: 'SENDING', lastSentAt: new Date(), sendCount: 1 } }), send: true };
        if (await tx.user.findFirst({ where: { email: { equals: row.newEmail, mode: 'insensitive' }, NOT: { id: row.userId } } }))
          throw new ConflictException('El email ya está en uso. Cancela esta solicitud e introduce otra dirección.');
        const now = new Date();
        await tx.user.update({ where: { id: row.userId }, data: { email: row.newEmail, sessionVersion: { increment: 1 } } });
        await tx.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
        await tx.preRegistration.updateMany({ where: { userId: row.userId, launchTokenUsedAt: null }, data: { launchTokenUsedAt: now } });
        await tx.newsletterMailJob.updateMany({ where: { userId: row.userId, kind: 'ACCESS', tokenUsedAt: null }, data: { tokenUsedAt: now } });
        return { row: await tx.emailChangeRequest.update({ where: { userId: row.userId }, data: { stage: 'COMPLETE' } }), send: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('El email ya está en uso.');
      throw error;
    }
    if (result.send) await this.deliver(result.row);
    return this.view(result.row);
  }

  async resend(userId: number) {
    const row = await serializableTransaction(this.prisma, async tx => {
      const current = await tx.emailChangeRequest.findUnique({ where: { userId } });
      if (!current) throw new BadRequestException('No hay una solicitud pendiente.');
      const action = current.stage === 'PENDING_CURRENT' ? 'authorize' : 'verify';
      await this.valid(tx, this.token(current.id, action), action);
      if (Date.now() - current.lastSentAt.getTime() < COOLDOWN || current.sendCount >= 5)
        throw new HttpException('Espera un minuto entre envíos. Máximo cinco por etapa.', 429);
      return tx.emailChangeRequest.update({ where: { userId }, data: { lastSentAt: new Date(), sendCount: { increment: 1 }, delivery: 'SENDING' } });
    });
    await this.deliver(row);
    return this.status(userId);
  }

  async cancel(userId: number) {
    await this.prisma.emailChangeRequest.updateMany({ where: { userId, stage: { in: ['PENDING_CURRENT', 'PENDING_NEW'] } }, data: { stage: 'CANCELLED' } });
    return this.status(userId);
  }
}
