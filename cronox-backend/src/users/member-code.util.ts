import { Prisma } from '@prisma/client';

const MEMBER_CODE_BLOCK_SIZE = 999_999n;
const MEMBER_CODE_SEQUENCE = 'public.user_member_code_seq';

const normalizeToBigInt = (value: bigint | number): bigint =>
  typeof value === 'bigint' ? value : BigInt(value);

const formatMemberCodeFromIndex = (index: bigint): string => {
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
  const result = await tx.$queryRaw<{ n: bigint | number }[]>(
    `SELECT nextval('${MEMBER_CODE_SEQUENCE}') as n;`,
  );
  const nextValue = result?.[0]?.n;

  if (nextValue === undefined || nextValue === null) {
    throw new Error('No se pudo obtener el siguiente valor para memberCode');
  }

  return formatMemberCodeFromIndex(normalizeToBigInt(nextValue));
};
