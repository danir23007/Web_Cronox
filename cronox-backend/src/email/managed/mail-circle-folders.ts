import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function mailCircleNumber(value: string | number): number | null {
  const token = String(value).normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/^circulo\s*/i, '').trim().toUpperCase();
  return ({ '1': 1, I: 1, '2': 2, II: 2, '3': 3, III: 3, '4': 4, IV: 4, '5': 5, V: 5 } as Record<string, number>)[token] ?? null;
}

/** Caller owns the transaction. Initializers may create; imports only resolve. */
export async function resolveMailCircle(tx: Prisma.TransactionClient, senderKey: string, requested: string | number, initialize = false) {
  const circle = mailCircleNumber(requested);
  if (!circle) throw new BadRequestException('Círculo no válido: utiliza 1, 2, 3, 4 o 5.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-circle:${senderKey}`}))`;
  const name = `Círculo ${circle}`;
  const found = await tx.emailTemplateFolder.findUnique({ where: { senderKey_name: { senderKey, name } } });
  if (found) return found;
  if (!initialize) throw new NotFoundException(`Falta la carpeta canónica ${name}; inicializa la biblioteca de este buzón.`);
  return tx.emailTemplateFolder.create({ data: { senderKey, name, position: circle - 1 } });
}
