import { Prisma } from '@prisma/client';

const MEMBER_CODE_BLOCK_SIZE = 999_999n;
const MEMBER_CODE_SEQUENCE = 'public.user_member_code_seq';
const MEMBER_CODE_REGEX = /^CRX(\d*)-(\d{6})$/;
const MAX_RETRIES = 5;

const normalizeToBigInt = (value: bigint | number | string): bigint =>
  typeof value === 'bigint' ? value : BigInt(value);

export const formatMemberCodeFromIndex = (index: bigint): string => {
  const offsetIndex = index - 1n;
  const million = offsetIndex / MEMBER_CODE_BLOCK_SIZE;
  const withinBlock = (offsetIndex % MEMBER_CODE_BLOCK_SIZE) + 1n;

  const prefix = million === 0n ? 'CRX' : `CRX${million.toString()}`;
  const paddedWithin = withinBlock.toString().padStart(6, '0');

  return `${prefix}-${paddedWithin}`;
};

const parseMemberCodeToIndex = (code: string): bigint | null => {
  const match = code.match(MEMBER_CODE_REGEX);
  if (!match) return null;

  const [, prefixDigits, withinDigits] = match;
  const prefix = prefixDigits ? normalizeToBigInt(prefixDigits) : 0n;
  const within = normalizeToBigInt(withinDigits);

  return prefix * MEMBER_CODE_BLOCK_SIZE + within;
};

const isMissingSequenceError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '42P01';

const queryNextSequenceValue = async (
  tx: Prisma.TransactionClient,
): Promise<bigint> => {
  const result = await tx.$queryRaw<{ n: bigint | string }[]>(
    Prisma.sql`SELECT nextval(${Prisma.raw(`'${MEMBER_CODE_SEQUENCE}'`)}) AS n;`,
  );

  const nextValue = result?.[0]?.n;

  if (nextValue === undefined || nextValue === null) {
    throw new Error('No se pudo obtener el siguiente valor para memberCode');
  }

  return normalizeToBigInt(nextValue);
};

const getMaxMemberCodeIndex = async (
  tx: Prisma.TransactionClient,
): Promise<bigint> => {
  const result = await tx.$queryRaw<{ max_n: bigint | string | null }[]>(
    Prisma.sql`
      SELECT MAX(
        COALESCE(NULLIF(matches[1], '')::bigint, 0) * ${Prisma.raw(
          MEMBER_CODE_BLOCK_SIZE.toString(),
        )} + matches[2]::bigint
      ) AS max_n
      FROM (
        SELECT regexp_matches("memberCode", '^CRX(\\d*)-(\\d{6})$') AS matches
        FROM "User"
        WHERE "memberCode" IS NOT NULL
      ) AS sub
      WHERE matches IS NOT NULL;
    `,
  );

  const maxValue = result?.[0]?.max_n;
  return maxValue ? normalizeToBigInt(maxValue) : 0n;
};

const setSequenceValue = async (
  tx: Prisma.TransactionClient,
  value: bigint,
) => {
  const nextValue = value === 0n ? 1n : value;
  const isCalled = value !== 0n;

  await tx.$queryRaw(
    Prisma.sql`SELECT setval(${Prisma.raw(
      `'${MEMBER_CODE_SEQUENCE}'`,
    )}, ${nextValue}, ${isCalled});`,
  );
};

const ensureSequenceExists = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRaw(
    Prisma.sql`
      CREATE SEQUENCE IF NOT EXISTS ${Prisma.raw(MEMBER_CODE_SEQUENCE)}
      INCREMENT 1
      MINVALUE 1
      START 1;
    `,
  );
};

const syncSequenceWithMax = async (tx: Prisma.TransactionClient) => {
  await ensureSequenceExists(tx);
  const [maxIndex, currentSequence] = await Promise.all([
    getMaxMemberCodeIndex(tx),
    tx
      .$queryRaw<{ last_value: bigint | string }[]>(
        Prisma.sql`SELECT last_value FROM ${Prisma.raw(MEMBER_CODE_SEQUENCE)};`,
      )
      .then((rows) =>
        rows?.[0]?.last_value ? normalizeToBigInt(rows[0].last_value) : 0n,
      )
      .catch(() => 0n),
  ]);

  const targetValue = maxIndex > currentSequence ? maxIndex : currentSequence;
  const normalizedTarget =
    maxIndex === 0n && currentSequence <= 1n ? 0n : targetValue;

  await setSequenceValue(tx, normalizedTarget);

  return normalizedTarget;
};

const getNextSequenceValue = async (
  tx: Prisma.TransactionClient,
): Promise<bigint> => {
  try {
    return await queryNextSequenceValue(tx);
  } catch (error) {
    if (!isMissingSequenceError(error)) throw error;
  }

  await syncSequenceWithMax(tx);
  return queryNextSequenceValue(tx);
};

export const getNextSequentialMemberCode = async (
  tx: Prisma.TransactionClient,
): Promise<string> => {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const nextValue = await getNextSequenceValue(tx);
    const memberCode = formatMemberCodeFromIndex(nextValue);

    const existing = await tx.user.findUnique({
      where: { memberCode },
      select: { id: true },
    });

    if (!existing) return memberCode;

    await syncSequenceWithMax(tx);
    attempt += 1;
  }

  throw new Error(
    'No se pudo generar un memberCode único después de varios intentos. Verifica la secuencia y los datos existentes.',
  );
};
