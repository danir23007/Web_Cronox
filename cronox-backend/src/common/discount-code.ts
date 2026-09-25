import { randomInt } from 'crypto';
import type { Prisma } from '@prisma/client';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Six unbiased characters; collisions checked in both current and legacy stores. */
export async function generateDiscountCode(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'discount-code-allocation'}))`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const [promo, legacy] = await Promise.all([
      tx.promoCode.findUnique({ where: { code }, select: { id: true } }),
      tx.discountCode.findUnique({ where: { code }, select: { id: true } }),
    ]);
    if (!promo && !legacy) return code;
  }
  throw new Error('Unable to allocate a unique discount code');
}
