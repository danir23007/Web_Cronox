import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AdminLabelsController } from './admin-labels.controller';
import { AdminLabelsService } from './admin-labels.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import request from 'supertest';
import {
  labelDocument,
  labelPdf,
  labelSvg,
  validateLabelTemplate,
} from './label-document';
import { defaultLabelTemplate } from './label-template';
import { upgradeLabelTemplate } from './label-template-upgrade';
import { LabelLayoutDto } from './labels.dto';

describe('Physical labels HTTP and print contract', () => {
  let app: any;
  const service = {
    list: jest.fn(() => ({ items: [] })),
    generate: jest.fn(() => ({ items: [] })),
    preview: jest.fn(() => ({ html: '' })),
    pdf: jest.fn(() => Buffer.from('%PDF-1.3\nfixture')),
    resolve: jest.fn(() => ({})),
    template: jest.fn(() => ({
      template: defaultLabelTemplate(),
      defaults: defaultLabelTemplate(),
      revision: 0,
    })),
    saveTemplate: jest.fn(({ template }) => {
      validateLabelTemplate(template);
      return { template, revision: 1 };
    }),
    resetTemplate: jest.fn(() => ({
      template: defaultLabelTemplate(),
      revision: 2,
    })),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminLabelsController],
      providers: [
        AdminGuard,
        RolesGuard,
        { provide: AdminLabelsService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: any) {
          const req = ctx.switchToHttp().getRequest();
          req.user = { role: req.headers['x-test-role'] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());
  it.each(['USER', 'FRIEND', 'UNKNOWN', ''])(
    'rejects %s on every route',
    async (role) => {
      for (const [method, path] of [
        ['get', ''],
        ['post', '/generate'],
        ['post', '/preview'],
        ['post', '/pdf'],
        ['get', '/template'],
        ['post', '/template'],
        ['post', '/template/reset'],
        ['get', '/resolve/CRX0000000001'],
      ]) {
        await request(app.getHttpServer())
          [method]('/admin/physical-labels' + path)
          .set('x-test-role', role)
          .send({ lines: [{ variantId: 1, quantity: 1 }] })
          .expect(403);
      }
    },
  );
  it.each(['ADMIN', 'SUPERADMIN'])(
    'allows existing administrative role %s',
    async (role) => {
      await request(app.getHttpServer())
        .get('/admin/physical-labels')
        .set('x-test-role', role)
        .expect(200)
        .expect('Cache-Control', 'no-store');
    },
  );
  it.each(
    [
      [],
      [{ variantId: 1, quantity: 0 }],
      [{ variantId: 1, quantity: 501 }],
      [{ variantId: 1, quantity: 1.2 }],
      [{ variantId: '1', quantity: 1 }],
      [{ variantId: 1, quantity: 1, price: 10 }],
    ].map((lines) => [lines]),
  )('rejects malformed selection %j', async (lines) => {
    await request(app.getHttpServer())
      .post('/admin/physical-labels/generate')
      .set('x-test-role', 'ADMIN')
      .send({ lines })
      .expect(400);
  });
  it('rejects unsafe page geometry and unknown inputs before rendering', async () => {
    for (const layout of [
      { width: '60' },
      { gap: -1 },
      { pageHeight: 10000 },
      { width: null },
      { unexpected: 1 },
    ])
      await request(app.getHttpServer())
        .post('/admin/physical-labels/preview')
        .set('x-test-role', 'ADMIN')
        .send({ lines: [{ variantId: 1, quantity: 1 }], layout })
        .expect(400);
  });
  it('prints exact quantities in millimetres, with fixed vector bars and escaped long names', () => {
    const html = labelDocument(
      [
        {
          code: 'CRX0000000001',
          name: '<script>"&'.repeat(80),
          size: 'M',
          quantity: 500,
        },
      ],
      {
        ...new LabelLayoutDto(),
        profile: 'custom',
        orientation: 'portrait',
        width: 60,
        height: 35,
        margin: 10,
        gap: 3,
        padding: 1.5,
        pageWidth: 210,
        pageHeight: 297,
      },
    );
    expect(html.match(/<g class="label"/g)).toHaveLength(500);
    expect(html.match(/<section class="sheet">/g)).toHaveLength(
      Math.ceil(500 / 21),
    );
    expect(html).toContain('@page{size:210mm 297mm;margin:0}');
    expect(html).toContain('viewBox="0 0 60 35"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<svg');
    expect(() =>
      labelDocument(
        [{ code: 'CRX0000000001', name: 'test', size: 'M', quantity: 1 }],
        { ...new LabelLayoutDto(), width: 40, padding: 8 },
      ),
    ).toThrow();
  });
  it('defaults to 62 × 35 and still rejects compression in smaller formats', async () => {
    const layout = new LabelLayoutDto(),
      lines = [
        { code: 'CRX0000000001', name: 'Producto', size: 'M', quantity: 1 },
      ];
    expect(layout.width).toBe(62);
    expect(layout.height).toBe(35);
    expect(labelDocument(lines, layout)).toContain(
      '@page{size:62mm 35mm;margin:0}',
    );
    expect(() =>
      labelDocument(lines, {
        ...layout,
        profile: 'brother-ql700-dk22223',
        width: 50,
        pageWidth: 50,
        padding: 2,
      }),
    ).toThrow('46.8 mm');
    await expect(
      labelPdf(lines, {
        ...layout,
        profile: 'brother-ql700-dk22223',
        width: 50,
        pageWidth: 50,
        padding: 2,
      }),
    ).rejects.toThrow('No se comprimirá');
  });
  it('supports horizontal 62 × 35 labels, one page per label and vector PDF', async () => {
    const layout = {
      ...new LabelLayoutDto(),
      height: 35,
      pageHeight: 35,
      orientation: 'portrait',
    };
    const lines = [
      {
        code: 'CRX0000000001',
        name: 'Nombre largo '.repeat(60),
        size: 'US 8',
        quantity: 3,
      },
      {
        code: 'CRX2147483647',
        name: 'Otro producto',
        size: 'XXL',
        quantity: 1,
      },
    ];
    const html = labelDocument(lines, layout);
    expect(html.match(/<section class="sheet">/g)).toHaveLength(4);
    expect(html.match(/class="label"/g)).toHaveLength(4);
    expect(html).toContain('@page{size:62mm 35mm;margin:0}');
    expect(html).not.toContain('rotate(90)');
    expect(html).toContain('width="46.8" height="10"');
    expect((await labelPdf(lines, layout)).subarray(0, 4).toString()).toBe(
      '%PDF',
    );
    expect(() => labelSvg(lines[0], { ...layout, padding: 1 })).toThrow(
      '1,55 mm',
    );
    expect(() => labelSvg(lines[0], { ...layout, margin: 2 })).toThrow('3 mm');
  });
  it('downloads a protected PDF attachment', async () => {
    await request(app.getHttpServer())
      .post('/admin/physical-labels/pdf')
      .set('x-test-role', 'ADMIN')
      .send({ lines: [{ variantId: 1, quantity: 1 }] })
      .expect(201)
      .expect('Content-Type', 'application/pdf')
      .expect(
        'Content-Disposition',
        'attachment; filename="cronox-etiquetas.pdf"',
      );
  });
  it('validates shared-template writes and exposes explicit restoration', async () => {
    const template = defaultLabelTemplate();
    await request(app.getHttpServer())
      .get('/admin/physical-labels/template')
      .set('x-test-role', 'ADMIN')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .post('/admin/physical-labels/template')
      .set('x-test-role', 'ADMIN')
      .send({ revision: 0, template })
      .expect(201);
    await request(app.getHttpServer())
      .post('/admin/physical-labels/template')
      .set('x-test-role', 'ADMIN')
      .send({ revision: -1, template })
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/physical-labels/template/reset')
      .set('x-test-role', 'ADMIN')
      .send({ revision: 1 })
      .expect(201);
    const hidden = defaultLabelTemplate();
    hidden.elements.find((e) => e.kind === 'barcode')!.visible = false;
    await request(app.getHttpServer())
      .post('/admin/physical-labels/template')
      .set('x-test-role', 'ADMIN')
      .send({ revision: 1, template: hidden })
      .expect(400);
  });
  it('composes hidden fields and custom text while rejecting clipping and overlaps', () => {
    const template = defaultLabelTemplate(),
      line = {
        code: 'CRX0000000001',
        name: 'Nombre largo '.repeat(90),
        size: 'XXL',
        quantity: 1,
      };
    template.elements.find((e) => e.kind === 'color')!.visible = false;
    template.elements.find((e) => e.kind === 'brand')!.visible = false;
    template.elements.push({
      id: 'custom-test',
      kind: 'custom',
      visible: true,
      text: 'HECHO PARA DURAR',
      fontSizePt: 7.5,
      align: 'right',
      gapAfter: 0.5,
      maxLines: 1,
    });
    validateLabelTemplate(template);
    const svg = labelSvg(line, template);
    expect(svg).toContain('HECHO PARA DURAR');
    expect(svg).not.toContain('>CRONOX<');
    expect(svg).toContain('text-anchor="end"');
    template.elements.find((e) => e.id === 'custom-test')!.fontSizePt = 18;
    template.elements.find((e) => e.id === 'custom-test')!.maxLines = 3;
    expect(() => validateLabelTemplate(template)).toThrow();
    const malformed = defaultLabelTemplate();
    malformed.elements.push({ ...malformed.elements[0] });
    expect(() => validateLabelTemplate(malformed)).toThrow('único');
    const barcodeOnly = defaultLabelTemplate();
    barcodeOnly.elements.forEach((e) => (e.visible = e.kind === 'barcode'));
    validateLabelTemplate(barcodeOnly);
    expect(labelSvg(line, barcodeOnly)).not.toContain('>Talla:');
  });
  it('accepts legible extreme settings and rejects invalid glyphs and overflowing margins', () => {
    const template = defaultLabelTemplate();
    template.layout.height = 100;
    template.layout.pageHeight = 100;
    template.elements.forEach((e) => (e.visible = e.kind === 'barcode'));
    template.elements.push({
      id: 'custom-large',
      kind: 'custom',
      visible: true,
      text: 'Hola',
      fontSizePt: 18,
      align: 'left',
      gapAfter: 5,
      maxLines: 1,
    });
    validateLabelTemplate(template);
    template.elements.find((e) => e.kind === 'custom')!.text = 'Texto 😊';
    expect(() => validateLabelTemplate(template)).toThrow('caracteres');
    template.elements.find((e) => e.kind === 'custom')!.text = 'Hola';
    template.layout.margin = 25;
    template.layout.height = 60;
    template.layout.pageHeight = 60;
    expect(() => validateLabelTemplate(template)).toThrow(
      'El código no se reducirá',
    );
  });
  it('converts older paper settings without mutating compatible content and flags invalid adaptations', () => {
    const legacy = defaultLabelTemplate();
    legacy.schemaVersion = 1;
    legacy.layout = {
      ...legacy.layout,
      profile: 'brother-ql700-dk22225',
      width: 38,
      height: 60,
      pageWidth: 38,
      pageHeight: 60,
      orientation: 'rotated',
      padding: 1.5,
    };
    legacy.elements.forEach((e) => (e.gapAfter = 0.5));
    const before = JSON.stringify(legacy),
      converted = upgradeLabelTemplate(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(converted.changed).toBe(true);
    expect(converted.valid).toBe(true);
    expect(converted.template.layout).toMatchObject({
      width: 62,
      height: 35,
      orientation: 'portrait',
      padding: 1.55,
    });
    expect(
      converted.template.elements.map((e) => [
        e.kind,
        e.visible,
        e.text,
        e.fontSizePt,
        e.align,
      ]),
    ).toEqual(
      legacy.elements.map((e) => [
        e.kind,
        e.visible,
        e.text,
        e.fontSizePt,
        e.align,
      ]),
    );
    expect(upgradeLabelTemplate(converted.template).changed).toBe(false);
    legacy.elements.push({
      id: 'custom-huge',
      kind: 'custom',
      visible: true,
      text: 'MUCHO TEXTO '.repeat(10),
      fontSizePt: 18,
      align: 'center',
      gapAfter: 5,
      maxLines: 3,
    });
    const invalid = upgradeLabelTemplate(legacy);
    expect(invalid.valid).toBe(false);
    expect(invalid.notice).toContain('necesita revisión');
    expect(legacy.schemaVersion).toBe(1);
  });
});
