import 'reflect-metadata';
import { automaticLabelContent, labelPresentation } from './label-presentation';
import { automaticLabelTemplate } from './label-template';
import { labelSvg, labelDocument } from './label-document';
import { AdminLabelsService } from './admin-labels.service';

describe('Automatic physical labels', () => {
  it('adds exactly 1 mm above the barcode while preserving the barcode and identifier bottom positions', () => {
    const line = automaticLabelContent(
        { name: 'CORE TEE - black' },
        { size: 'XS' },
        'CRX0000000001',
        1,
      ),
      current = automaticLabelTemplate();
    const previous = JSON.parse(JSON.stringify(current));
    Object.assign(previous.layout, {
      profile: 'brother-ql700-dk22223',
      width: 50,
      pageWidth: 50,
    });
    previous.elements.find((e: any) => e.kind === 'size').gapAfter = 0.1;
    previous.elements.find((e: any) => e.kind === 'barcode').align = 'left';
    const before = labelSvg(line, previous),
      after = labelSvg(line, current);
    const ys = (svg: string) =>
      [...svg.matchAll(/<text[^>]* y="([^"]+)"/g)].map((m) => Number(m[1]));
    const barcodeY = (svg: string) =>
      Number(/data-element="barcode" x="[^"]+" y="([^"]+)"/.exec(svg)![1]);
    expect(ys(before)[2] - ys(after)[2]).toBeCloseTo(1, 8);
    expect(barcodeY(after)).toBeCloseTo(barcodeY(before), 8);
    expect(ys(after)[3]).toBeCloseTo(ys(before)[3], 8);
    expect(after).toContain('width="46.8" height="10"');
    expect(labelDocument([line], current)).toContain(
      '@page{size:62mm 35mm;margin:0}',
    );
  });
  it('returns a stable missing-code reason that the interface can explicitly recover from', async () => {
    const service = new AdminLabelsService({
      productVariant: {
        findMany: async () => [
          {
            id: 1,
            size: 'XS',
            product: { name: 'CORE TEE - black' },
            physicalBarcode: null,
          },
        ],
      },
    } as any);
    await expect(
      service.preview({ lines: [{ variantId: 1, quantity: 2 }] }),
    ).rejects.toMatchObject({
      response: {
        code: 'LABEL_CODES_MISSING',
        message: expect.stringContaining('Faltan códigos'),
      },
    });
  });
  it('ignores stored historical designs and refuses browser design overrides', async () => {
    const db = {
      productVariant: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            size: 'XS',
            product: { name: 'CORE TEE - black' },
            physicalBarcode: { code: 'CRX0000000001' },
          },
        ]),
      },
      labelTemplateSettings: {
        findUnique: jest.fn(() => {
          throw Error('Historical design must not be used');
        }),
      },
    };
    const service = new AdminLabelsService(db as any),
      selection = { lines: [{ variantId: 1, quantity: 1 }] };
    const result = await service.preview(selection);
    expect(result.html).toContain('@page{size:62mm 35mm;margin:0}');
    expect(result.html).not.toContain('size:50mm');
    expect(result.html).toContain('COLOUR: BLACK');
    expect(result.html).toContain('SIZE: XS');
    expect(db.labelTemplateSettings.findUnique).not.toHaveBeenCalled();
    await expect(
      service.preview({ ...selection, template: automaticLabelTemplate() }),
    ).rejects.toThrow('diseño automático fijo');
  });
  it.each(['ASHEN SHELL', 'CORE TEE - graphite'])(
    'prepares both print and PDF with a dash for missing or unrecognized color: %s',
    async (name) => {
      const db = {
        productVariant: {
          findMany: jest.fn(async () => [
            {
              id: 1,
              size: 'M',
              product: { name },
              physicalBarcode: { code: 'CRX0000000001' },
            },
          ]),
        },
      };
      const service = new AdminLabelsService(db as any),
        selection = { lines: [{ variantId: 1, quantity: 1 }] };
      const preview = await service.preview(selection);
      expect(preview.quantity).toBe(1);
      expect(preview.html).toContain('COLOUR: -');
      expect(preview.html).toContain(name.toUpperCase());
      expect(preview.html).toContain('CRX0000000001');
      expect((await service.pdf(selection)).subarray(0, 5).toString()).toBe(
        '%PDF-',
      );
    },
  );
  it.each([
    ['CORE TEE - black', 'Core-tee', 'BLACK'],
    ['CORE TEE - grey', 'Core-tee', 'GREY'],
    ['CORE TEE - gray', 'Core-tee', 'GREY'],
    ['CORE TEE - gris', 'Core-tee', 'GREY'],
    ['Sudadera Norte - negro', 'Sudadera Norte', 'BLACK'],
  ])(
    'presents %s without changing the source name',
    (name, modelName, color) => {
      const product = { name };
      expect(labelPresentation(product)).toMatchObject({
        modelName,
        color,
        warning: null,
      });
      expect(product.name).toBe(name);
    },
  );
  it('prefers structured variant colors and does not strip arbitrary words or use slugs', () => {
    expect(
      labelPresentation(
        { name: 'CORE TEE', color: 'black' },
        { colour: 'gris' },
      ),
    ).toMatchObject({
      modelName: 'Core-tee',
      color: 'GREY',
      colorSource: 'structured',
    });
    for (const name of [
      'CORE TEE black',
      'BLACK EDITION',
      'Sudadera - graphite',
      'CORE TEE - black edition',
      'Modelo - constructor',
      'Modelo - __proto__',
    ]) {
      const result = labelPresentation({ name });
      expect(result.modelName).toBe(name);
      expect(result.color).toBeNull();
      expect(result.warning).toBeNull();
    }
    expect(
      automaticLabelContent(
        { name: 'Modelo sin color' },
        { size: 'S' },
        'CRX0000000001',
        1,
      ),
    ).toMatchObject({
      name: 'MODELO SIN COLOR',
      color: '-',
      code: 'CRX0000000001',
    });
  });
  it('joins the bold brand and regular uppercase name, uses equal regular detail fonts and centers the identifier', () => {
    const line = automaticLabelContent(
        { name: 'CORE TEE - black' },
        { size: 'XS' },
        'CRX0000000001',
        1,
      ),
      template = automaticLabelTemplate(),
      svg = labelSvg(line, template);
    expect(template.layout).toMatchObject({
      width: 62,
      height: 35,
      pageWidth: 62,
      pageHeight: 35,
      orientation: 'portrait',
    });
    expect(template.elements.map((e) => e.kind)).toEqual([
      'brand',
      'name',
      'color',
      'size',
      'barcode',
      'identifier',
    ]);
    expect(
      template.elements
        .filter((e) => !['identifier', 'barcode'].includes(e.kind))
        .every((e) => e.align === 'left'),
    ).toBe(true);
    expect(template.elements.find((e) => e.kind === 'identifier')!.align).toBe(
      'center',
    );
    expect(
      template.elements
        .filter((e) => ['name', 'size', 'color'].includes(e.kind))
        .map((e) => e.fontSizePt),
    ).toEqual([6.5, 6.5, 6.5]);
    for (const text of [
      'CRONOX:',
      'CORE-TEE',
      'COLOUR: BLACK',
      'SIZE: XS',
      'CRX0000000001',
    ])
      expect(svg).toContain('>' + text + '<');
    const xs = [...svg.matchAll(/<text x="([^"]+)"/g)].map((m) => Number(m[1]));
    for (const x of xs.slice(0, 3)) expect(x).toBeCloseTo(7.5670611111, 8);
    expect(xs[3]).toBe(29.45);
    expect(
      Number(/data-element="barcode" x="([^"]+)/.exec(svg)![1]),
    ).toBeCloseTo(6.05);
    expect(svg.match(/text-anchor="middle"/g)).toHaveLength(1);
    expect(svg).toContain(
      '<tspan dx="0.65" font-weight="normal">CORE-TEE</tspan>',
    );
    expect(svg.match(/font-weight="bold"/g)).toHaveLength(1);
    expect(svg).not.toContain('data-element="brand"');
    expect(svg).not.toContain('Talla:');
    const positions = [...svg.matchAll(/<text[^>]* y="([^"]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it('truncates only the visible long name, preserves the color row and exact page counts', () => {
    const line = automaticLabelContent(
      { name: 'Nombre extraordinariamente largo '.repeat(20) + ' - grey' },
      { size: 'M' },
      'CRX0000000009',
      3,
    );
    const svg = labelSvg(line, automaticLabelTemplate());
    expect(svg).toContain('…');
    expect(svg).toContain('COLOUR: GREY');
    expect(svg).toContain('SIZE: M');
    const second = automaticLabelContent(
        { name: 'CORE TEE - black' },
        { size: 'XL' },
        'CRX0000000001',
        1,
      ),
      html = labelDocument([line, second], automaticLabelTemplate());
    expect(html.match(/<section class="sheet">/g)).toHaveLength(4);
    expect(html).toContain('@page{size:62mm 35mm;margin:0}');
    expect(html).not.toContain('210mm');
    expect(html).not.toContain('rotate(');
  });
});
