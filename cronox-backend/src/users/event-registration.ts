import type { Prisma } from '@prisma/client';

export const EVENT_REGISTRATION_OBSERVATION = 'Usuario de evento';

/** Called only in the transaction that INSERTs a new account, never on login,
 * existing-email verification or a registration retry that finds an account. */
export async function recordEventRegistration(tx: Prisma.TransactionClient, user: { id: number; identityUid: string }) {
  await tx.adminNote.upsert({
    where: { id: `event-registration:${user.identityUid}` },
    create: { id: `event-registration:${user.identityUid}`, targetType: 'user', targetId: String(user.id),
      content: EVENT_REGISTRATION_OBSERVATION, authorAdminId: null },
    update: {},
  });
}
