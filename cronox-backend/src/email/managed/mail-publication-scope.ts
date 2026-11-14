import { Prisma } from '@prisma/client';
import { mailCircleNumber } from './mail-circle-folders';

export function recipientMailCircle(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

export function mailPublicationKey(purpose: string, circle: number) {
  if (!recipientMailCircle(circle)) throw Error('INVALID_PUBLICATION_CIRCLE');
  return `${purpose}:CIRCLE_${circle}`;
}

/** Prefer immutable metadata; old snapshots can use the canonical folder ID
 * stored at publication time, never the mutable draft's current folder. */
export async function snapshotMailCircle(db: Pick<Prisma.TransactionClient, 'emailTemplateFolder'>, senderKey: string, snapshot: any): Promise<number | null> {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const hints: number[] = [];
  for (const value of [snapshot.publicationCircle, snapshot.campaignCircle,
    snapshot.purpose === 'ORDER_CONFIRMATION' ? snapshot.document?.orderCircle : undefined]) {
    if (value == null) continue;
    const circle = recipientMailCircle(value); if (!circle) return null; hints.push(circle);
  }
  if (hints.length) return hints.every(circle => circle === hints[0]) ? hints[0] : null;
  if (snapshot.folderId) {
    const folder = await db.emailTemplateFolder.findFirst({ where: { id: snapshot.folderId, senderKey }, select: { name: true } });
    if (!folder) return null;
    const circle = mailCircleNumber(folder.name); if (!circle) return null; hints.push(circle);
  }
  return hints.length && hints.every(circle => circle === hints[0]) ? hints[0] : null;
}
