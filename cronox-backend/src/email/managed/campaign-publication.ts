import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mailCircleNumber } from './mail-circle-folders';

export function campaignPublicationKey(familyId: string, circle: number) {
  if (!familyId || !Number.isInteger(circle) || circle < 1 || circle > 5) throw new BadRequestException('Familia o círculo de campaña no válidos.');
  return `CAMPAIGN_FAMILY:${familyId}:CIRCLE_${circle}`;
}

/** Manual campaign identity is independent of every automatic mail purpose. */
export async function manualCampaignScope(db: Prisma.TransactionClient, senderKey: string, template: any) {
  if (senderKey !== 'INFO' || template.senderKey !== senderKey || template.purpose !== null || !template.familyId || template.archivedAt)
    throw new BadRequestException('Selecciona una plantilla manual disponible de una familia de Información.');
  const family = await db.campaignTemplateFamily.findUnique({ where: { id: template.familyId } });
  const folder = await db.emailTemplateFolder.findFirst({ where: { id: template.folderId, senderKey }, select: { name: true } });
  const circle = folder && mailCircleNumber(folder.name);
  if (!family || !circle || template.campaignCircle !== circle)
    throw new BadRequestException('La familia, la plantilla y la carpeta deben corresponder al mismo círculo del I al V.');
  return { family, circle, publicationKey: campaignPublicationKey(family.id, circle) };
}
