import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_PURPOSES, SAMPLE_DATA } from './mail-catalog';
import {
  adaptFirstPartyDocument,
  structuredDocumentForPurpose,
} from './mail-template-documents';
import { MailBlock, renderMail } from './mail-renderer';

const legacy = (file: string) => ({
  blocks: [
    {
      type: 'html',
      html: readFileSync(join(__dirname, '../templates', file), 'utf8'),
    },
  ],
});
const flatten = (blocks: MailBlock[]): MailBlock[] =>
  blocks.flatMap((block) => [
    block,
    ...(block.columns ? block.columns.flatMap(flatten) : []),
  ]);

describe('first-party managed mail documents', () => {
  it.each(MAIL_PURPOSES)(
    'creates a structured visual document for $key',
    (purpose) => {
      const document = structuredDocumentForPurpose(purpose.key);
      expect(document?.sourceKind).toBe('cronox-first-party');
      expect(
        flatten(document!.blocks).some((block) => block.type === 'html'),
      ).toBe(false);
      expect(() =>
        renderMail(document, purpose.subject, '', purpose.key, SAMPLE_DATA),
      ).not.toThrow();
    },
  );
  it('adapts the real order confirmation into editable and transactional blocks', () => {
    const source = legacy('order-confirmation.hbs');
    const document = adaptFirstPartyDocument(
      'ORDER_CONFIRMATION',
      source,
    ) as ReturnType<typeof structuredDocumentForPurpose>;
    expect(document).not.toBeNull();
    expect(document?.legacySource).toEqual(source);
    const blocks = flatten(document!.blocks);
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'heading',
          text: 'Gracias por visitar Cronox',
        }),
        expect.objectContaining({
          type: 'text',
          text: '¡Agradecemos que formes parte de esto! Tu paquete se está preparando y te llegará muy pronto. ☽',
        }),
        expect.objectContaining({
          type: 'button',
          text: 'Ver tu pedido',
          url: '{{orderUrl}}',
          buttonBackground: '#060606',
        }),
        expect.objectContaining({ type: 'orderItems' }),
        expect.objectContaining({ type: 'orderTotals' }),
        expect.objectContaining({ type: 'customerDetails' }),
      ]),
    );
    expect(blocks.some((block) => block.type === 'html')).toBe(false);
    const draft = renderMail(
      document,
      'Confirmación',
      '',
      'ORDER_CONFIRMATION',
    );
    expect(draft.html).toContain('{{#each items}}');
    expect(draft.html).toContain('{{lineTotalFormatted}}');
    const preview = renderMail(
      document,
      'Confirmación',
      '',
      'ORDER_CONFIRMATION',
      SAMPLE_DATA,
      undefined,
      true,
    );
    expect(preview.html).toContain('Camiseta CRONOX');
    expect(preview.html).toContain('69,80 €');
    expect(preview.html).toContain('Calle Ejemplo 12');
    expect(preview.html).not.toContain('{{');
  });

  it.each([
    [
      'ORDER_SHIPPED',
      'order-shipped.hbs',
      'Buenas noticias. Tu pedido está en camino.',
      'trackingDetails',
    ],
    [
      'ORDER_DELIVERED',
      'order-delivered.hbs',
      'Tu pedido ha sido entregado.',
      'statusDetails',
    ],
  ])(
    'adapts the real %s template and keeps normal copy editable',
    (purpose, file, copy, dynamicType) => {
      const document = adaptFirstPartyDocument(
        purpose,
        legacy(file),
      ) as ReturnType<typeof structuredDocumentForPurpose>;
      const blocks = flatten(document!.blocks);
      const editable = blocks.find((block) => block.text === copy);
      expect(editable?.type).toBe('heading');
      expect(blocks.some((block) => block.type === dynamicType)).toBe(true);
      editable!.text = copy.replace(/\.$/, ' actualizado.');
      const rendered = renderMail(
        document,
        'Estado del pedido',
        '',
        purpose,
        SAMPLE_DATA,
        undefined,
        true,
      );
      expect(rendered.html).toContain('actualizado.');
      expect(rendered.html).not.toContain('{{');
    },
  );

  it('is idempotent and leaves already structured drafts untouched', () => {
    const document = structuredDocumentForPurpose(
      'ORDER_DELIVERED',
      legacy('order-delivered.hbs'),
    )!;
    expect(adaptFirstPartyDocument('ORDER_DELIVERED', document)).toBe(document);
  });
});
