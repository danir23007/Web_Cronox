import 'reflect-metadata';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { automaticLabelTemplate } from '../admin/labels/label-template';
import { labelPresentation } from '../admin/labels/label-presentation';
const front = path.resolve(__dirname, '../../../cronox-front'),
  script = readFileSync(path.join(front, 'assets/admin-labels.js'), 'utf8');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
describe('Simplified automatic label screen', () => {
  let dom: JSDOM, w: any, fetch: jest.Mock;
  beforeEach(() => {
    dom = new JSDOM('<div id="physicalLabels"></div>', {
      url: 'http://localhost/admin.html',
      runScripts: 'outside-only',
    });
    w = dom.window;
    w.CRONOX_API = {
      API_BASE: '',
      getCsrfHeaders: async () => ({ 'X-CSRF-Token': 'test' }),
    };
    w.URL.createObjectURL = jest.fn(() => 'blob:http://localhost/labels-test');
    w.URL.revokeObjectURL = jest.fn();
    w.HTMLAnchorElement.prototype.click = jest.fn();
    const products = [
      {
        id: 1,
        name: 'CORE TEE - black',
        slug: 'reference-black',
        isActive: true,
        images: [],
        variants: [
          {
            id: 12,
            size: 'XS',
            sku: 'REF-XS',
            stockQty: 0,
            isActive: true,
            physicalBarcode: null,
          },
          {
            id: 13,
            size: 'M',
            sku: 'REF-M',
            stockQty: 7,
            isActive: true,
            physicalBarcode: { code: 'CRX0000000013' },
          },
        ],
      },
      {
        id: 2,
        name: 'CORE TEE - grey',
        slug: 'reference-grey',
        isActive: false,
        images: [],
        variants: [
          {
            id: 14,
            size: 'L',
            sku: 'GREY-L',
            stockQty: 0,
            isActive: true,
            physicalBarcode: null,
          },
        ],
      },
    ].map((p) => ({ ...p, labelPresentation: labelPresentation(p) }));
    fetch = jest.fn(async (url: string, options: any) =>
      url.endsWith('/pdf')
        ? {
            ok: true,
            headers: { get: () => 'application/pdf' },
            blob: async () => new Blob(['%PDF-1.3\nfixture']),
          }
        : url.endsWith('/preview')
          ? {
              ok: false,
              json: async () => ({ message: 'Vista de prueba recibida' }),
            }
          : {
              ok: true,
              json: async () =>
                options.method === 'GET'
                  ? {
                      items: products,
                      page: 1,
                      totalPages: 1,
                      total: 2,
                      layout: automaticLabelTemplate().layout,
                    }
                  : { items: [] },
            },
    );
    w.fetch = fetch;
    w.eval(script);
  });
  afterEach(() => dom.window.close());
  const change = (selector: string, value: any, event = 'change') => {
    const el = w.document.querySelector(selector);
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
    el.dispatchEvent(new w.Event(event, { bubbles: true }));
  };
  it('starts with folded accessible products and no editor or template requests', async () => {
    expect(fetch).not.toHaveBeenCalled();
    await w.CRONOX_LABELS.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe('GET');
    const cards = [...w.document.querySelectorAll('.labels-product')];
    expect(cards).toHaveLength(2);
    expect(cards.every((d: any) => !d.open && d.querySelector('summary'))).toBe(
      true,
    );
    expect(cards[0].querySelector('summary').textContent).toContain('Core-tee');
    expect(cards[0].querySelector('summary').textContent).toContain('BLACK');
    expect(cards[1].querySelector('summary').textContent).toContain('GREY');
    expect(w.document.querySelector('[data-template-editor]')).toBeNull();
    expect(w.document.querySelector('select[data-profile]')).toBeNull();
    expect(readFileSync(path.join(front, 'admin.html'), 'utf8')).not.toContain(
      'src="assets/admin-label-template-editor.js',
    );
  });
  it('opens several products and preserves selection/quantities when folding', async () => {
    await w.CRONOX_LABELS.load();
    const first = w.document.querySelector('[data-product-id="1"]'),
      second = w.document.querySelector('[data-product-id="2"]');
    first.open = true;
    second.open = true;
    await settle();
    expect(first.open && second.open).toBe(true);
    change('[data-variant="12"]', true);
    change('[data-quantity="12"]', '3', 'input');
    change('[data-variant="13"]', true);
    change('[data-quantity="13"]', '2', 'input');
    expect(first.querySelector('[data-product-summary]').textContent).toBe(
      '2 tallas · 5 etiquetas',
    );
    first.open = false;
    await settle();
    first.open = true;
    expect(w.document.querySelector('[data-variant="12"]').checked).toBe(true);
    expect(w.document.querySelector('[data-quantity="12"]').value).toBe('3');
    expect(w.document.querySelector('[data-quantity="13"]').value).toBe('2');
    expect(second.open).toBe(true);
  });
  it('preserves selected quantities through filters and writes codes only explicitly', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="12"]', true);
    change('[data-quantity="12"]', '4');
    w.document
      .querySelector('form')
      .dispatchEvent(
        new w.Event('submit', { bubbles: true, cancelable: true }),
      );
    await settle();
    expect(w.document.querySelector('[data-variant="12"]').checked).toBe(true);
    expect(w.document.querySelector('[data-quantity="12"]').value).toBe('4');
    expect(fetch.mock.calls.every((c) => c[1].method === 'GET')).toBe(true);
    w.document.querySelector('[data-action=generate]').click();
    await settle();
    const write = fetch.mock.calls.find((c) => c[0].endsWith('/generate'));
    expect(JSON.parse(write![1].body)).toEqual({
      lines: [{ variantId: 12, quantity: 4 }],
    });
    expect(write![1].headers['X-CSRF-Token']).toBe('test');
  });
  it('uses server automatic composition and requests exactly one test copy', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="12"]', true);
    change('[data-quantity="12"]', '8');
    w.document.querySelector('[data-action=test]').click();
    await settle();
    const post = fetch.mock.calls.find((c) => c[0].endsWith('/preview'));
    expect(JSON.parse(post![1].body)).toEqual({
      lines: [{ variantId: 12, quantity: 1 }],
    });
    expect(w.document.querySelector('[data-selection]').textContent).toContain(
      '8 etiquetas',
    );
    expect(w.document.querySelector('[role=status]').textContent).toBe(
      'Vista de prueba recibida',
    );
  });
  it('rejects invalid quantities without a request and never loses the selection on failure', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="12"]', true);
    change('[data-quantity="12"]', '1.5');
    w.document.querySelector('[data-action=preview]').click();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(w.document.querySelector('[role=status]').textContent).toContain(
      'enteros',
    );
    expect(w.document.querySelector('[data-variant="12"]').checked).toBe(true);
    change('[data-quantity="12"]', '2');
    fetch.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({
        message: 'Falta un color fiable. Corrige el dato de origen.',
      }),
    }));
    w.document.querySelector('[data-action=preview]').click();
    await settle();
    expect(w.document.querySelector('[role=status]').textContent).toContain(
      'color fiable',
    );
    expect(w.document.querySelector('[data-quantity="12"]').value).toBe('2');
  });
  it('explains missing selection for all three actions and never submits a form', async () => {
    await w.CRONOX_LABELS.load();
    for (const action of ['print', 'test', 'pdf']) {
      const button = w.document.querySelector(`[data-action=${action}]`);
      expect(button.type).toBe('button');
      button.click();
      expect(
        w.document.querySelector('[data-action-message]').textContent,
      ).toContain('Selecciona al menos una talla');
      expect(w.document.querySelector('[data-feedback]').hidden).toBe(false);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps a valid PDF download available and releases its URL when the selection changes', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="13"]', true);
    change('[data-quantity="13"]', '3');
    w.document.querySelector('[data-action=pdf]').click();
    await settle();
    expect(w.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(w.URL.revokeObjectURL).not.toHaveBeenCalled();
    const link = w.document.querySelector('[data-prepared] a[download]');
    expect(link.download).toBe('cronox-etiquetas.pdf');
    expect(w.HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(
      w.document.querySelector('[data-action-message]').textContent,
    ).toContain('PDF válido preparado');
    change('[data-quantity="13"]', '4');
    expect(w.URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:http://localhost/labels-test',
    );
    expect(w.document.querySelector('[data-prepared]').hidden).toBe(true);
  });
  it('requires an explicit generation click and resumes the original PDF request without losing quantities', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="12"]', true);
    change('[data-quantity="12"]', '4');
    fetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        code: 'LABEL_CODES_MISSING',
        message: 'Faltan códigos.',
      }),
    }));
    w.document.querySelector('[data-action=pdf]').click();
    await settle();
    expect(fetch.mock.calls.some((c) => c[0].endsWith('/generate'))).toBe(
      false,
    );
    const continuation = w.document.querySelector(
      '[data-action=generate-continue]',
    );
    expect(continuation.textContent).toContain('y continuar');
    continuation.click();
    await settle();
    await settle();
    expect(
      fetch.mock.calls.filter((c) => c[0].endsWith('/generate')),
    ).toHaveLength(1);
    expect(fetch.mock.calls.filter((c) => c[0].endsWith('/pdf'))).toHaveLength(
      2,
    );
    expect(w.document.querySelector('[data-quantity="12"]').value).toBe('4');
    expect(
      w.document.querySelector('[data-action-message]').textContent,
    ).toContain('PDF válido preparado');
  });
  it.each([401, 403, 500])(
    'shows a recoverable HTTP %s error instead of swallowing the click',
    async (status) => {
      await w.CRONOX_LABELS.load();
      change('[data-variant="13"]', true);
      fetch.mockImplementationOnce(async () => ({
        ok: false,
        status,
        json: async () => {
          throw Error('HTML error page');
        },
      }));
      w.document.querySelector('[data-action=pdf]').click();
      await settle();
      expect(
        w.document.querySelector('[data-feedback]').getAttribute('role'),
      ).toBe('alert');
      expect(
        w.document.querySelector('[data-action-message]').textContent.length,
      ).toBeGreaterThan(20);
      expect(w.document.querySelector('[data-action=pdf]').disabled).toBe(
        false,
      );
      expect(w.document.querySelector('[data-variant="13"]').checked).toBe(
        true,
      );
      expect(w.URL.createObjectURL).not.toHaveBeenCalled();
    },
  );
  it('rejects a successful HTTP response that is not actually a PDF', async () => {
    await w.CRONOX_LABELS.load();
    change('[data-variant="13"]', true);
    fetch.mockImplementationOnce(async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      blob: async () => new Blob(['<!DOCTYPE html>login']),
    }));
    w.document.querySelector('[data-action=pdf]').click();
    await settle();
    expect(
      w.document.querySelector('[data-action-message]').textContent,
    ).toContain('PDF válido');
    expect(w.URL.createObjectURL).not.toHaveBeenCalled();
    expect(w.document.querySelector('[data-action=pdf]').disabled).toBe(false);
  });
});
