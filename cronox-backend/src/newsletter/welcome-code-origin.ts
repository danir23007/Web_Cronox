import { Prisma } from '@prisma/client';

// Account welcomes persist personal ownership + firstOrderOnly. The optional
// newsletter relation is independent consent; ownership survives its absence.
export const welcomeCodeOrigin: Prisma.PromoCodeWhereInput = {
  OR: [
    { newsletterSubscription: { isNot: null } },
    { firstOrderOnly: true, ownerEmail: { not: null } },
    { firstOrderOnly: true, ownerUserId: { not: null } },
  ],
};
