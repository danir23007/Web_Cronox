import { Prisma } from '@prisma/client';

const MEMBER_CODE_BLOCK_SIZE = 999_999n;


export const formatMemberCodeFromIndex = (index: bigint): string => {
  const offsetIndex = index - 1n;
  const million = offsetIndex / MEMBER_CODE_BLOCK_SIZE;
  const withinBlock = (offsetIndex % MEMBER_CODE_BLOCK_SIZE) + 1n;

  const prefix = million === 0n ? 'CRX' : `CRX${million.toString()}`;
  const paddedWithin = withinBlock.toString().padStart(6, '0');

  return `${prefix}-${paddedWithin}`;
};

export const getNextSequentialMemberCode = async (
  tx: Prisma.TransactionClient,
): Promise<string> => {
  // The INSERT trigger consumes this allocation in the same transaction.
  // Rollback therefore never consumes a number. Hold the coordinator row
  // until insertion, including newsletter and concurrent account creation.
  const rows = await tx.$queryRaw<{ nextId: number; ready: boolean }[]>`
    SELECT "nextId", ready FROM "UserNumberingState" WHERE id=1 FOR UPDATE`;
  if (!rows[0]?.ready) throw new Error('User numbering requires its reviewed migration');
  return formatMemberCodeFromIndex(BigInt(rows[0].nextId));
};
