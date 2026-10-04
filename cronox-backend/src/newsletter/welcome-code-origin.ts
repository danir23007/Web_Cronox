import { Prisma } from '@prisma/client';

// The newsletter producer persists personal ownership + firstOrderOnly and the
// subscription relation. Ownership also survives older/replaced relations.
export const welcomeCodeOrigin: Prisma.PromoCodeWhereInput = {
  OR: [
    { newsletterSubscription: { isNot: null } },
    { firstOrderOnly: true, ownerEmail: { not: null } },
    { firstOrderOnly: true, ownerUserId: { not: null } },
  ],
};
