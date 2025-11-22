import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.shippingMethod.upsert({
    where: { code: 'STANDARD' },
    update: {},
    create: {
      code: 'STANDARD',
      name: 'Envío estándar',
      price: 295, // 2,95 €
      isActive: true,
      countries: ['ES'],
    },
  });

  await prisma.shippingMethod.upsert({
    where: { code: 'EXPRESS' },
    update: {},
    create: {
      code: 'EXPRESS',
      name: 'Envío express',
      price: 495, // 4,95 €
      isActive: true,
      countries: ['ES'],
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
