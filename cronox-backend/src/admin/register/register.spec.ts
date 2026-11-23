import { RegisterController, registerOptions } from './register.controller';

const live = {
  id: 1,
  isActive: true,
  price: 3495,
  currency: 'EUR',
  name: 'CORE TEE - grey',
  imageUrl: null,
  activeLotId: 'new',
  lotManaged: true,
  variants: [{ id: 13, isActive: true, size: 'XS', price: null, stockQty: 4 }],
  inventoryLots: [
    {
      id: 'new',
      number: 3,
      name: 'Nueva',
      slices: [{ variantId: 13, available: 4 }],
      profile: { price: 1234 },
    },
    {
      id: 'old',
      number: 11,
      name: 'Anterior',
      slices: [{ variantId: 13, available: 5 }],
      webOfferPriceCents: 100,
      profile: {
        name: 'Core',
        currency: 'EUR',
        price: 2300,
        variants: [{ id: 13, price: 1755 }],
      },
    },
  ],
};
function register(product: unknown = live) {
  const tx = {
    product: { findMany: jest.fn().mockResolvedValue([product]) },
    salePoint: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const db = { $transaction: (fn: Function) => fn(tx) };
  return new RegisterController(db as any);
}
describe('ticket presencial', () => {
  it('expone el número real de cada tirada, filtra el producto y valida el contexto sin escribir', async () => {
    const db = { product: { findMany: jest.fn().mockResolvedValue([live]) }, salePoint: { findFirst: jest.fn().mockResolvedValue({id:'point'}) } };
    const controller = new RegisterController(db as any);
    const data = await controller.catalog({q:'',offset:0,productId:1,pointId:'point'});
    expect(data.products[0].options.map(o => [o.lotId,o.lotNumber])).toEqual([['new',3],['old',11]]);
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:1})}));
    expect(db.salePoint.findFirst).toHaveBeenCalledWith({where:{id:'point',archived:false,deletedAt:null},select:{id:true}});
    db.salePoint.findFirst.mockResolvedValue(null as any);
    await expect(controller.catalog({q:'',offset:0,pointId:'missing'})).rejects.toThrow('punto de venta');
    expect(db.product.findMany).toHaveBeenCalledTimes(1);
  });
  it('aplica la oferta de cada lote con las mismas fechas y desactivación del checkout', async () => {
    const now = new Date();
    const offer = {
      webOfferPriceCents: 1500,
      webOfferPreviousCents: 2300,
      webOfferStartsAt: new Date(now.getTime() - 1000),
      webOfferEndsAt: new Date(now.getTime() + 10000),
      webOfferConfirmedAt: now,
      webOfferDisabledAt: null,
    };
    const product = {
      ...live,
      inventoryLots: live.inventoryLots.map((l) => ({ ...l, ...offer })),
    };
    expect(
      registerOptions(product as any, now).map((o) => o.unitPriceCents),
    ).toEqual([1500, 1500]);
    expect(
      (
        await register(product).quote({
          items: [
            { variantId: 13, lotId: 'old', quantity: 3 },
            { variantId: 13, lotId: 'new', quantity: 2 },
          ],
        })
      ).totalCents,
    ).toBe(7500);
    for (const state of [
      { webOfferStartsAt: new Date(now.getTime() + 1000) },
      { webOfferEndsAt: now },
      { webOfferDisabledAt: now },
    ]) {
      const modified = {
        ...product,
        inventoryLots: product.inventoryLots.map((l) => ({ ...l, ...state })),
      };
      expect(
        registerOptions(modified as any, now).map((o) => o.unitPriceCents),
      ).toEqual([3495, 1755]);
    }
    expect(
      registerOptions(product as any, new Date(now.getTime() + 10000)).map(
        (o) => o.unitPriceCents,
      ),
    ).toEqual([3495, 1755]);
  });
  it('el código nuevo exige su propio lote y el antiguo permite elegir entre lotes', async () => {
    const variant = { id: 13, product: live };
    const db = {
      physicalLotBarcode: {
        findUnique: jest.fn().mockResolvedValue({ variant, lotId: 'old' }),
      },
      physicalBarcode: { findUnique: jest.fn().mockResolvedValue({ variant }) },
    };
    const service = new RegisterController(db as any);
    expect(
      (await service.barcode({ code: 'CRL0000000001' })).map((o) => o.lotId),
    ).toEqual(['old']);
    expect(
      (await service.barcode({ code: 'CRX0000000500' })).map((o) => o.lotId),
    ).toEqual(['old']);
    db.physicalLotBarcode.findUnique.mockResolvedValue(null as any);
    expect(
      (await service.barcode({ code: 'CRX0000000013' })).map((o) => o.lotId),
    ).toEqual(['new', 'old']);
    db.physicalLotBarcode.findUnique.mockResolvedValue({
      variant,
      lotId: 'missing',
    });
    await expect(service.barcode({ code: 'CRL0000000001' })).rejects.toThrow(
      'disponible',
    );
  });
  it('normaliza el correo, exige coincidencia exacta y devuelve solo el resumen', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 8,
        name: 'Ana Ruiz',
        email: 'ana@example.com',
        memberCode: 'CRX-000008',
        accountState: 'ACTIVE',
        circleLevel: 1,
      },
    ]);
    const service = new RegisterController({ user: { findMany } } as any);
    expect(await service.customer({ content: '  ANA@example.com  ' })).toEqual({
      id: 8,
      name: 'Ana Ruiz',
      email: 'ana@example.com',
      memberCode: 'CRX-000008',
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      email: { equals: 'ana@example.com', mode: 'insensitive' },
    });
    findMany.mockResolvedValue([]);
    await expect(
      service.customer({ content: 'unknown@example.com' }),
    ).rejects.toThrow('No se ha encontrado ninguna cuenta');
    findMany.mockResolvedValue([{}, {}]);
    await expect(
      service.customer({ content: 'ana@example.com' }),
    ).rejects.toThrow('varias cuentas');
    await expect(service.customer({ content: 'invalid@' })).rejects.toThrow(
      'válido',
    );
  });
  it('conserva precios y saldos separados por tirada, incluso con una promoción web', async () => {
    const r = await register().quote({
      items: [
        { variantId: 13, lotId: 'old', quantity: 2 },
        { variantId: 13, lotId: 'new', quantity: 1 },
        { variantId: 13, lotId: 'old', quantity: 1 },
      ],
    });
    expect(
      r.items.map((i) => [
        i.quantity,
        i.unitPriceCents,
        i.subtotalCents,
        i.color,
      ]),
    ).toEqual([
      [3, 1755, 5265, null],
      [1, 3495, 3495, 'GREY'],
    ]);
    expect(r).toMatchObject({
      units: 4,
      totalCents: 8760,
      customer: null,
      point: null,
    });
  });
  it('rechaza existencias agregadas insuficientes, punto retirado y tirada ambigua', async () => {
    await expect(
      register().quote({
        items: [
          { variantId: 13, lotId: 'new', quantity: 3 },
          { variantId: 13, lotId: 'new', quantity: 2 },
        ],
      }),
    ).rejects.toThrow('Disponibles: 4');
    await expect(
      register().quote({ items: [{ variantId: 13, quantity: 1 }] }),
    ).rejects.toThrow('tirada');
    await expect(
      register().quote({ pointId: 'retirado', items: [] }),
    ).rejects.toThrow('punto');
  });
  it('oculta productos inactivos y evita atribuir precios a tiradas sin ficha confirmada', () => {
    expect(registerOptions({ ...live, isActive: false } as any)).toEqual([]);
    const product = {
      ...live,
      inventoryLots: live.inventoryLots.map((l) => ({
        ...l,
        profilePending: true,
      })),
    };
    expect(registerOptions(product as any).map((o) => o.lotId)).toEqual([
      'new',
    ]);
  });
  it('muestra existencias cero y rechaza su incorporación', async () => {
    const product = {
      ...live,
      lotManaged: false,
      variants: [{ ...live.variants[0], stockQty: 0 }],
    };
    expect(registerOptions(product as any)[0].stock).toBe(0);
    await expect(
      register(product).quote({ items: [{ variantId: 13, quantity: 1 }] }),
    ).rejects.toThrow('Disponibles: 0');
  });
});
