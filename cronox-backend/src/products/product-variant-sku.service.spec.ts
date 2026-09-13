import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductService } from './product.service';

const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
type StoredVariant = {
  id: number;
  productId: number;
  size: (typeof sizes)[number];
  sku: string;
  price: number | null;
  stockQty: number;
  isActive: boolean;
};
type VariantCreateInput = Omit<StoredVariant, 'id'>;

describe('ProductService variant SKU generation', () => {
  const createHarness = () => {
    let storedVariants: StoredVariant[] = [];
    let lastVariantUpdate:
      | { where: { id: number }; data: Record<string, unknown> }
      | undefined;

    const baseProduct = {
      id: 1,
      name: 'Camiseta Core',
      slug: 'camiseta-core',
      description: null,
      price: 3495,
      currency: 'EUR',
      isActive: true,
      collection: null,
      searchKeywords: [],
      searchText: 'camiseta core',
      imageUrl: null,
      images: [],
      categories: [],
    };

    const tx = {
      product: {
        create: jest.fn().mockResolvedValue(baseProduct),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            ...baseProduct,
            variants: storedVariants,
          }),
        ),
        update: jest.fn().mockResolvedValue(baseProduct),
      },
      productVariant: {
        createMany: jest.fn(({ data }: { data: VariantCreateInput[] }) => {
          storedVariants = data.map((variant, index) => ({
            id: index + 1,
            ...variant,
          }));
          return Promise.resolve({ count: data.length });
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn(
          (args: { where: { id: number }; data: Record<string, unknown> }) => {
            lastVariantUpdate = args;
            return Promise.resolve({ id: 1 });
          },
        ),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productImage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      stockMovement: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };

    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: baseProduct.id,
          slug: baseProduct.slug,
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          Promise.resolve(callback(tx)),
        ),
    };

    return {
      service: new ProductService(prisma as unknown as PrismaService),
      tx,
      getStoredVariants: () => storedVariants,
      setStoredVariants: (variants: typeof storedVariants) => {
        storedVariants = variants;
      },
      getLastVariantUpdate: () => lastVariantUpdate,
    };
  };

  it('accepts and creates the six admin variants without SKU', async () => {
    const variants = sizes.map((size) => ({ size, stockQty: 0 }));
    const dto = plainToInstance(CreateProductDto, {
      name: 'Camiseta Core',
      price: 3495,
      variants,
    });

    const validationErrors = await validate(dto);
    expect(validationErrors).toEqual([]);

    const harness = createHarness();
    await harness.service.createProduct(dto);
    const saved = harness.getStoredVariants();
    const generatedSkus = saved.map((variant) => variant.sku);

    expect(saved).toHaveLength(6);
    expect(
      generatedSkus.every((sku) => typeof sku === 'string' && sku.length > 0),
    ).toBe(true);
    expect(new Set(generatedSkus).size).toBe(6);
    saved.forEach((variant) => {
      expect(variant.sku).toContain(
        `camiseta-core-${variant.size.toLowerCase()}-`,
      );
    });
  });

  it('preserves an explicitly supplied SKU', async () => {
    const harness = createHarness();

    await harness.service.createProduct({
      name: 'Camiseta Core',
      price: 3495,
      variants: [{ size: 'M', stockQty: 4, sku: 'SKU-EXTERNO-M' }],
    });

    expect(harness.getStoredVariants()[0].sku).toBe('SKU-EXTERNO-M');
  });

  it('generates a non-empty SKU through the independent variant endpoint flow', async () => {
    const harness = createHarness();

    await harness.service.createVariants(1, { size: 'XL', stockQty: 2 });

    expect(harness.getStoredVariants()[0].sku).toMatch(
      /^camiseta-core-xl-[a-f0-9]{32}$/,
    );
  });

  it('generates a non-empty SKU for variantsToCreate', async () => {
    const harness = createHarness();

    await harness.service.updateProduct(1, {
      variantsToCreate: [{ size: 'XXL', stockQty: 1 }],
    });

    expect(harness.getStoredVariants()[0].sku).toMatch(
      /^camiseta-core-xxl-[a-f0-9]{32}$/,
    );
  });

  it('does not change existing SKUs when other product and variant fields are edited', async () => {
    const harness = createHarness();
    harness.setStoredVariants([
      {
        id: 1,
        productId: 1,
        size: 'S',
        sku: 'SKU-ORIGINAL-S',
        price: null,
        stockQty: 3,
        isActive: true,
      },
    ]);

    await harness.service.updateProduct(1, {
      name: 'Nombre actualizado',
      price: 3995,
      variantsToUpdate: [{ id: 1, size: 'S', stockQty: 9 }],
    });

    const updateCall = harness.getLastVariantUpdate();
    expect(updateCall?.where).toEqual({ id: 1 });
    expect(updateCall?.data).not.toHaveProperty('sku');
    expect(harness.getStoredVariants()[0].sku).toBe('SKU-ORIGINAL-S');
  });
});
