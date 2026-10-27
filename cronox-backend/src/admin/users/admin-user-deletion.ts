import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserAccountState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { serializableTransaction } from '../../prisma/serializable-transaction';
import type { DeleteAdminUserDto } from './dto/delete-admin-user.dto';
import type { AdminUserUpdateRequestMetadata } from './admin-users.service';

const relationNames: Record<string, string> = {
  Order: 'pedidos y su historial financiero',
  CheckoutSnapshot: 'checkouts y reservas de stock',
  PromoCodeRedemption: 'usos de promociones',
  StockMovement: 'movimientos de stock',
  QrEventGroup: 'eventos QR creados',
  QrEventParticipant: 'inscripciones o registros de eventos QR',
  CircleUpgradeRequest: 'solicitudes de cambio de círculo',
  CirclePromotionRequest: 'solicitudes de promoción',
  AuditLog: 'acciones de auditoría realizadas',
  AdminNote: 'notas administrativas escritas',
  PointEntry: 'movimientos de puntos de venta',
  PointSale: 'ventas de puntos de venta',
  historial: 'historial de compras o devoluciones',
  DiscountCode: 'descuentos utilizados',
  PromoCode: 'promociones utilizadas',
  AccountWelcomeBenefit: 'beneficios asociados a compras',
  CheckoutEffect: 'obligaciones de un pago',
};

export async function deleteAdminUser(
  prisma: PrismaService,
  id: number,
  identityUid: string,
  dto: DeleteAdminUserDto,
  performedById: number,
  request: AdminUserUpdateRequestMetadata = {},
) {
  if (dto.confirmed !== true)
    throw new ConflictException(
      'Confirma expresamente la eliminación de esta cuenta.',
    );
  if (id === performedById)
    throw new ForbiddenException(
      'No puedes eliminar tu propia cuenta desde esta acción.',
    );
  try {
    return await serializableTransaction(prisma, async (tx) => {
      // Serializes concurrent deletion requests without taking the old global
      // identity-maintenance gate (HTTP requests hold its shared lock).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(824032,1)`;
      const actor = await tx.user.findUnique({
        where: { id: performedById },
        select: { role: true, accountState: true },
      });
      if (
        actor?.role !== Role.SUPERADMIN ||
        actor.accountState !== UserAccountState.ACTIVE
      ) {
        throw new ForbiddenException(
          'Solo un Super Admin activo puede eliminar usuarios.',
        );
      }
      const receipts = await tx.$queryRaw<{ identityUid: string }[]>`
        SELECT "identityUid" FROM "AdminUserDeletion" WHERE "userId"=${id}`;
      if (receipts.length) {
        if (receipts[0].identityUid !== identityUid)
          throw new ConflictException('La identidad de la cuenta no coincide.');
        return { deleted: true, id, identityUid, alreadyDeleted: true };
      }
      // A row lock fences FK inserts; serializable reads fence non-FK authorship
      // and counters. The SQL trigger repeats the blockers before any cascade.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new NotFoundException('Usuario no encontrado.');
      if (user.identityUid !== identityUid)
        throw new ConflictException(
          'La identidad de la cuenta ha cambiado. Recarga el listado.',
        );
      if (
        user.updatedAt.toISOString() !==
        new Date(dto.expectedUpdatedAt).toISOString()
      ) {
        throw new ConflictException(
          'La cuenta ha cambiado desde que se abrió. Recarga sus datos y revisa la eliminación.',
        );
      }
      if (
        user.role === Role.SUPERADMIN &&
        user.accountState === UserAccountState.ACTIVE &&
        (await tx.user.count({
          where: {
            role: Role.SUPERADMIN,
            accountState: UserAccountState.ACTIVE,
          },
        })) <= 1
      ) {
        throw new ForbiddenException(
          'Debe permanecer al menos un Super Admin activo.',
        );
      }
      const blockers = await tx.$queryRaw<
        { relation: string; total: bigint }[]
      >`SELECT * FROM cronox_user_delete_blockers(${id}::integer)`;
      if (blockers.length) {
        const reasons = blockers.map((row) => ({
          relation: row.relation,
          count: Number(row.total),
          description:
            relationNames[row.relation.split('.')[0]] ||
            `registros de ${row.relation}`,
        }));
        throw new ConflictException({
          code: 'USER_DELETE_BLOCKED',
          message: `No se puede eliminar esta cuenta: conserva ${[...new Set(reasons.map((row) => row.description))].join(', ')}.`,
          reasons,
        });
      }
      const email = user.email.trim().toLowerCase();
      // Same lock as newsletter/welcome issuance. Invalidate access-link tokens,
      // keep sent mail evidence, and stop pending deliveries for this account.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
      await tx.newsletterMailJob.updateMany({
        where: {
          OR: [
            { userId: id },
            { userId: null, email: { equals: email, mode: 'insensitive' } },
          ],
        },
        data: {
          tokenHash: null,
          tokenExpiresAt: new Date(),
          claimToken: null,
          userId: null,
        },
      });
      await tx.newsletterMailJob.updateMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          userId: null,
          status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
        },
        // FAILED is an existing terminal, non-retryable newsletter state.
        // The SQL CHECK does not permit CANCELLED; only QUEUED is claimed by
        // the worker. Preserve SENT/UNCERTAIN evidence, with tokens invalidated.
        data: { status: 'FAILED', errorCode: 'ACCOUNT_DELETED' },
      });
      await tx.newsletterSubscription.deleteMany({
        where: {
          OR: [
            { userId: id },
            { userId: null, email: { equals: email, mode: 'insensitive' } },
          ],
        },
      });
      // Unused personal codes remain reserved, disabled, and without a dangling
      // owner. Shared/historically used codes were rejected by the SQL guard.
      await tx.promoCode.updateMany({
        where: {
          OR: [
            { ownerUserId: id },
            {
              ownerUserId: null,
              ownerEmail: { equals: email, mode: 'insensitive' },
            },
          ],
        },
        data: { isActive: false, ownerUserId: null, ownerEmail: null },
      });
      await tx.emailDelivery.updateMany({
        where: {
          recipient: { equals: email, mode: 'insensitive' },
          status: { in: ['PENDING', 'QUEUED', 'RETRY'] },
        },
        data: {
          status: 'CANCELLED',
          pendingPayload: null,
          errorCode: 'ACCOUNT_DELETED',
        },
      });
      await tx.mailboxPermission.deleteMany({ where: { userId: id } });
      const devices = await tx.mailboxPushDevice.findMany({
        where: { userId: id },
        select: { id: true },
      });
      if (devices.length)
        await tx.mailboxPushDelivery.deleteMany({
          where: { deviceId: { in: devices.map((device) => device.id) } },
        });
      await tx.mailboxPushDevice.deleteMany({ where: { userId: id } });
      await tx.livePresence.deleteMany({ where: { userId: id } });
      const cart = await tx.cart.findUnique({
        where: { userId: id },
        select: { id: true },
      });
      if (cart)
        await tx.checkoutPresence.deleteMany({ where: { cartId: cart.id } });
      await tx.$executeRaw`INSERT INTO "AdminUserDeletion" ("userId","identityUid","memberCode","performedById")
        VALUES (${id},${identityUid}::uuid,${user.memberCode},${performedById})`;
      await tx.auditLog.create({
        data: {
          actorId: performedById,
          action: 'admin.user.delete',
          actionType: 'admin.user.delete',
          targetType: 'user',
          targetId: String(id),
          requestKey: `admin-user-delete:${identityUid}`,
          metadata: {
            identityUid,
            memberCode: user.memberCode,
            email: user.email,
            name:
              user.name ||
              [user.firstName, user.lastName].filter(Boolean).join(' ') ||
              null,
            role: user.role,
            request: { ...request },
            permanentIdentityRetired: true,
          },
        },
      });
      await tx.$executeRaw`SELECT set_config('cronox.user_delete',${identityUid},true)`;
      // Cascades only the allowlisted disposable data. Auth sessions, reset and
      // email-change tokens, favourites, waitlist and accreditation owner vanish.
      await tx.user.delete({ where: { id } });
      return { deleted: true, id, identityUid, alreadyDeleted: false };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2003', 'P2014'].includes(error.code)
    ) {
      throw new ConflictException({
        code: 'USER_DELETE_BLOCKED',
        message:
          'La cuenta conserva relaciones que impiden eliminarla. Recarga sus datos; no se ha eliminado nada.',
      });
    }
    throw error;
  }
}
