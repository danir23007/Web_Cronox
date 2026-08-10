import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const requiredCategories = [
    { name: 'Novedades', slug: 'novedades' },
    { name: 'Camisetas', slug: 'camisetas' },
    { name: 'Chaquetas', slug: 'chaquetas' },
    { name: 'Pantalones', slug: 'pantalones' },
    { name: 'Complementos', slug: 'complementos' },
  ];

  for (const category of requiredCategories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }

  const requiredShippingMethods = [
    { name: 'Envío estándar', price: 295 },
    { name: 'Envío express', price: 495 },
  ];

  for (const shippingMethod of requiredShippingMethods) {
    const existing = await prisma.shippingMethod.findFirst({
      where: { name: shippingMethod.name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.shippingMethod.create({
        data: {
          ...shippingMethod,
          isActive: true,
          countries: ['ES'],
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
