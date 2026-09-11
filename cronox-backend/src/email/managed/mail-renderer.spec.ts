import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_PURPOSES, SAMPLE_DATA } from './mail-catalog';
import { renderMail } from './mail-renderer';
import { EMAIL_TEMPLATE_FILE } from '../email.types';

describe('managed email rendering', () => {
  it.each(MAIL_PURPOSES)('preserves variables and loops for $key', (p) => {
    const source = readFileSync(
      join(__dirname, '../templates', EMAIL_TEMPLATE_FILE[p.template]),
      'utf8',
    );
    const document = { blocks: [{ type: 'html', html: source }] };
    const draft = renderMail(document, p.subject, '', p.key);
    for (const token of source.match(/\{\{[^}]+\}\}/g) || [])
      expect(draft.html).toContain(token);
    const preview = renderMail(
      document,
      p.subject,
      'Un avance',
      p.key,
      SAMPLE_DATA,
      undefined,
      true,
    );
    expect(preview.html).toContain('<!doctype html>');
    expect(preview.html).toContain('Un avance');
    expect(preview.html).not.toContain('{{');
    expect(preview.text.length).toBeGreaterThan(10);
    expect(
      renderMail(document, p.subject, 'Un avance', p.key, SAMPLE_DATA),
    ).toEqual(preview);
    if (source.includes('{{#each items}}'))
      expect(preview.html).toContain('Camiseta CRONOX');
  });
  it('removes unsafe HTML, event handlers, protocols, styles and editor attributes', () => {
    const result = renderMail(
      {
        blocks: [
          {
            type: 'html',
            html: '<script>alert(1)</script><form><input></form><iframe src="https://evil.test"></iframe><p onclick="alert(1)" contenteditable="true" style="background:url(https://evil.test);position:absolute">Seguro</p><a href="javascript:alert(1)">Link</a><img src="data:image/svg+xml,test" onerror="alert(1)">',
          },
        ],
      },
      'Prueba',
      '',
      null,
      SAMPLE_DATA,
    );
    expect(result.html).not.toMatch(
      /<script|<form|<iframe|onclick|onerror|javascript:|data:image|contenteditable|position:absolute|url\(/i,
    );
    expect(result.html).toContain('Seguro');
  });
  it('escapes runtime data and sanitizes URLs after expansion', () => {
    const result = renderMail(
      {
        blocks: [
          { type: 'text', text: '{{message}}' },
          { type: 'button', text: 'Continuar', url: '{{actionUrl}}' },
        ],
      },
      'Asunto',
      '',
      'PASSWORD_RESET',
      {
        message: '<img src=x onerror=alert(1)>',
        actionUrl: 'javascript:alert(1)',
      },
    );
    expect(result.html).toContain('&lt;img');
    expect(result.html).not.toContain('href="javascript:');
  });
  it('renders safe dynamic-block labels, borders and independent button styling', () => {
    const result = renderMail(
      {
        blocks: [
          {
            type: 'orderTotals',
            labels: { total: '<Total seguro>' },
            borderWidth: 1,
            borderColor: '#aabbcc',
            borderRadius: 6,
          },
          {
            type: 'button',
            text: 'Ver pedido',
            url: '{{orderUrl}}',
            background: '#f7f7f5',
            buttonBackground: '#060606',
            buttonColor: '#ffffff',
            borderRadius: 8,
          },
        ],
      },
      'Pedido',
      '',
      'ORDER_CONFIRMATION',
      SAMPLE_DATA,
    );
    expect(result.html).toContain('&lt;Total seguro&gt;');
    expect(result.html).toContain('border:1px solid #aabbcc');
    expect(result.html).toContain('background:#060606');
    expect(result.html).toContain('color:#ffffff');
    expect(result.html).toContain(`href="${String(SAMPLE_DATA.orderUrl)}"`);
  });
  it.each([
    '{{unknown}}',
    '{{{message}}}',
    '{{lookup this "constructor"}}',
    '{{#each items}}{{#each items}}{{message}}{{/each}}{{/each}}',
  ])('rejects unsupported expressions: %s', (expression) => {
    expect(() =>
      renderMail({ blocks: [{ type: 'text', text: expression }] }, 'Prueba'),
    ).toThrow();
  });
  it('requires essential transactional variables before publication', () => {
    expect(() =>
      renderMail(
        { blocks: [{ type: 'text', text: 'Hola' }] },
        'Prueba',
        '',
        'PASSWORD_RESET',
        SAMPLE_DATA,
        undefined,
        true,
      ),
    ).toThrow('actionUrl');
  });
  it('renders responsive columns, video fallback and account signature', () => {
    const document = {
      blocks: [
        {
          type: 'columns',
          columns: [
            [{ type: 'text', text: 'Columna 1' }],
            [
              {
                type: 'video',
                src: 'https://example.com/poster.png',
                url: 'https://example.com/video',
                alt: 'Ver nuestra colección',
              },
            ],
          ],
        },
      ],
    };
    const result = renderMail(
      document,
      'Vídeo',
      'Preheader',
      null,
      SAMPLE_DATA,
      { blocks: [{ type: 'text', text: 'Firma CRONOX' }] },
    );
    expect(result.html).toContain('class="mail-column"');
    expect(result.html).toContain('@media(max-width:480px)');
    expect(result.html).toContain('href="https://example.com/video"');
    expect(result.html).toContain('alt="Ver nuestra colección"');
    expect(result.html).not.toContain('<video');
    expect(result.text).toContain('Firma CRONOX');
  });
  it('renders linked images and email-safe section backgrounds with a color fallback', () => {
    const result = renderMail(
      {
        blocks: [
          {
            type: 'section',
            background: '#112233',
            backgroundImage: 'https://example.com/background.jpg',
            backgroundPosition: 'center top',
            backgroundSize: 'cover',
            columns: [
              [
                {
                  type: 'image',
                  src: 'https://example.com/product.png',
                  alt: 'Producto CRONOX',
                  url: 'https://example.com/product',
                  width: 420,
                  align: 'right',
                },
              ],
            ],
          },
        ],
      },
      'Colección',
    );
    expect(result.html).toContain(
      'background="https://example.com/background.jpg"',
    );
    expect(result.html).toContain('bgcolor="#112233"');
    expect(result.html).toContain('background-size:cover');
    expect(result.html).toContain('href="https://example.com/product"');
    expect(result.html).toContain('max-width:420px');
    expect(result.html).toContain('margin:0px 0px 0px auto');
  });
  it('rejects unsafe section background URLs', () => {
    const result = renderMail(
      {
        blocks: [
          {
            type: 'section',
            backgroundImage: 'javascript:alert(1)',
            columns: [[{ type: 'text', text: 'Seguro' }]],
          },
        ],
      },
      'Seguro',
    );
    expect(result.html).not.toContain('javascript:');
    expect(result.html).toContain('Seguro');
  });
});
