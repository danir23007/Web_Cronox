import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMail } from '../email/managed/mail-renderer';

const read = (file: string) =>
  readFileSync(join(__dirname, '../../../cronox-front', file), 'utf8');

describe('PLANTILLAS MAILS visual workspace', () => {
  it('shows the new delivery history without treating SMTP acceptance as inbox receipt', async () => {
    const dom = new JSDOM('<div id="mailFeedback"></div><div id="mailWorkspace"></div>', { url: 'http://localhost/admin.html', runScripts: 'outside-only' });
    const win = dom.window as any;
    win.CRONOX_MAIL_DOCUMENT = {};
    win.CRONOX_API = { admin: { mailRequest: jest.fn(async (path: string) => path.startsWith('/deliveries')
      ? { total: 1, items: [{ recipient: 'test@example.test', subject: '<unsafe>', senderKey: 'INFO', purpose: 'NEWSLETTER_WELCOME', status: 'SMTP_ACCEPTED', createdAt: new Date().toISOString() }] }
      : []) } };
    win.eval(read('assets/admin-mails.js'));
    await win.CRONOX_MAILS.load();
    win.document.querySelector('[data-mail-action="deliveries"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(win.document.body.textContent).toContain('Aceptado por SMTP');
    expect(win.document.body.textContent).toContain('no acredita recepción');
    expect(win.document.querySelector('unsafe')).toBeNull();
    expect(win.document.querySelector('[data-mail-action="delivery-next"]').disabled).toBe(true);
    dom.window.close();
  });
  it('navigates account → circle → templates and edits the canvas directly', async () => {
    const dom = new JSDOM(
      '<div id="mailFeedback"></div><div id="mailWorkspace"></div>',
      { url: 'http://localhost/admin.html', runScripts: 'outside-only' },
    );
    const folders = [{ id: 'f1', name: 'Círculo 1', _count: { templates: 1 } }];
    const template = {
      id: 't1',
      name: 'Pedido entregado',
      folderId: 'f1',
      subject: 'Tu pedido ha sido entregado',
      preheader: 'Ya está contigo',
      purpose: 'ORDER_DELIVERED',
      signatureMode: 'none',
      revision: 1,
      document: {
        blocks: [
          {
            type: 'heading',
            text: 'Tu pedido ha sido entregado',
            background: '#ffffff',
            color: '#202124',
          },
        ],
      },
    };
    const api = jest.fn((path: string, method?: string, body?: unknown) => {
      if (!path)
        return Promise.resolve([
          {
            key: 'ORDERS',
            name: 'CRONOX',
            email: 'orders@cronox.es',
            configured: false,
            counts: { folders: 1, templates: 1 },
          },
          {
            key: 'SUPPORT',
            name: 'CRONOX Support',
            email: 'support@cronox.es',
            configured: true,
            counts: { folders: 1, templates: 1 },
          },
        ]);
      if (path.endsWith('/initialize')) return Promise.resolve({});
      if (path.endsWith('/folders')) return Promise.resolve(folders);
      if (path.endsWith('/signatures')) return Promise.resolve([]);
      if (path === '/catalog')
        return Promise.resolve([
          {
            key: 'ORDER_DELIVERED',
            senderKey: 'ORDERS',
            name: 'Pedido entregado',
            variables: [{ key: 'orderId', description: 'Número de pedido' }],
          },
        ]);
      if (path.includes('/templates?'))
        return Promise.resolve({
          items: [
            {
              id: 't1',
              name: template.name,
              subject: template.subject,
              published: true,
              updatedAt: new Date().toISOString(),
            },
          ],
          total: 1,
        });
      if (path.includes('/assets?'))
        return Promise.resolve({ items: [], total: 0 });
      if (path.endsWith('/assets') && method === 'POST')
        return Promise.resolve({
          id: 'asset-1',
          url: 'https://storage.example.test/mail-image.png',
          alt: 'mail-image',
        });
      if (path.endsWith('/templates/t1/draft-targets'))
        return Promise.resolve({
          purpose: 'ORDER_DELIVERED',
          targets: [
            {
              id: 't1',
              folderId: 'f1',
              folderName: 'Círculo 1',
              revision: 1,
              current: true,
            },
          ],
        });
      if (path.endsWith('/templates/t1')) {
        if (method === 'PATCH')
          return Promise.resolve({
            ...template,
            ...(body && typeof body === 'object' ? body : {}),
            revision: 2,
          });
        return Promise.resolve(template);
      }
      if (path.endsWith('/preview')) {
        const preview = body as {
          document: unknown;
          subject: string;
          preheader: string;
        };
        return Promise.resolve(
          renderMail(preview.document, preview.subject, preview.preheader),
        );
      }
      return Promise.reject(new Error('Ruta inesperada: ' + path));
    });
    Object.assign(dom.window, {
      CRONOX_API: { admin: { mailRequest: api } },
      confirm: () => true,
    });
    dom.window.eval(read('assets/admin-mail-document.js'));
    dom.window.eval(read('assets/admin-mails.js'));
    const mails = (
      dom.window as unknown as {
        CRONOX_MAILS: { load: () => Promise<void> };
      }
    ).CRONOX_MAILS;
    await mails.load();
    expect(
      dom.window.document.querySelectorAll('.mail-account-card'),
    ).toHaveLength(2);
    expect(
      dom.window.document.querySelectorAll(
        '.mail-account-card .mail-card-icon',
      ),
    ).toHaveLength(0);
    expect(dom.window.document.body.textContent).toContain('orders@cronox.es');
    const click = async (selector: string) => {
      const element = dom.window.document.querySelector(
        selector,
      ) as HTMLButtonElement;
      expect(element).not.toBeNull();
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await click('[data-mail-action=account]');
    expect(dom.window.document.body.textContent).toContain('Elige un círculo');
    expect(
      dom.window.document.querySelector('[data-mail-action=folder-rename]'),
    ).toBeNull();
    expect(
      dom.window.document.querySelector('[data-mail-action=folder-delete]'),
    ).toBeNull();
    await click('[data-mail-action=circle]');
    expect(dom.window.document.body.textContent).toContain('Pedido entregado');
    await click('[data-mail-action=edit]');
    const direct = dom.window.document.querySelector(
      '[data-edit-text="0"]',
    ) as HTMLElement;
    expect(direct.closest('[data-block]')?.hasAttribute('draggable')).toBe(
      false,
    );
    expect(
      direct
        .closest('[data-block]')
        ?.querySelector('.mail-drag-handle')
        ?.getAttribute('draggable'),
    ).toBe('true');
    direct.textContent = 'Entrega completada';
    direct.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(dom.window.document.body.textContent).toContain(
      'Cambios sin guardar',
    );
    await click('[data-type=image]');
    await click('[data-mail-action=assets]');
    const upload = dom.window.document.querySelector(
      '#mailUpload',
    ) as HTMLInputElement;
    const file = new dom.window.File(['png'], 'mail-image.png', {
      type: 'image/png',
    });
    Object.defineProperty(upload, 'files', { value: [file] });
    upload.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      dom.window.document.querySelector(
        'img[src="https://storage.example.test/mail-image.png"]',
      ),
    ).not.toBeNull();
    await click('[data-mail-action=clear-selection]');
    const stage = dom.window.document.querySelector('.mail-stage')!;
    const dropped = new dom.window.File(['jpeg'], 'dropped.jpg', {
      type: 'image/jpeg',
    });
    const drop = new dom.window.Event('drop', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [dropped], types: ['Files'] },
    });
    stage.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await click('[data-mail-action=save]');
    expect(dom.window.document.querySelector('.mail-save-modal')).toBeNull();
    expect(
      api.mock.calls.some(([path, method, body]) => {
        const saved = body as {
          document: { blocks: Array<{ text?: string; src?: string }> };
        };
        return (
          path.endsWith('/templates/t1') &&
          method === 'PATCH' &&
          saved.document.blocks[0].text === 'Entrega completada' &&
          saved.document.blocks[1].src ===
            'https://storage.example.test/mail-image.png' &&
          saved.document.blocks[2].src ===
            'https://storage.example.test/mail-image.png'
        );
      }),
    ).toBe(true);
    expect(
      api.mock.calls.filter(
        ([path, method, body]) =>
          path.endsWith('/assets') &&
          method === 'POST' &&
          body instanceof dom.window.FormData,
      ),
    ).toHaveLength(2);
    expect(dom.window.document.body.textContent).toContain('Borrador guardado');
    dom.window.close();
  });

  it('offers matching circles and saves the selected drafts in one request', async () => {
    const dom = new JSDOM(
      '<div id="mailFeedback"></div><div id="mailWorkspace"></div>',
      { url: 'http://localhost/admin.html', runScripts: 'outside-only' },
    );
    const folders = [
      { id: 'f1', name: 'Círculo 1', _count: { templates: 1 } },
      { id: 'f2', name: 'Círculo 2', _count: { templates: 1 } },
      { id: 'f3', name: 'Círculo 3', _count: { templates: 1 } },
    ];
    const template = {
      id: 't1',
      name: 'Confirmación de pedido',
      folderId: 'f1',
      subject: 'Confirmación',
      preheader: 'Gracias por tu compra',
      purpose: 'ORDER_CONFIRMATION',
      signatureMode: 'none',
      revision: 1,
      document: {
        blocks: [
          {
            type: 'orderItems',
            labels: { empty: 'Sin artículos' },
          },
          {
            type: 'image',
            src: 'https://storage.example.test/shared.png',
            alt: 'Producto',
          },
        ],
      },
    };
    let multiBody: unknown;
    const api = jest.fn((path: string, method?: string, body?: unknown) => {
      if (!path)
        return Promise.resolve([
          {
            key: 'ORDERS',
            email: 'orders@cronox.es',
            configured: true,
            counts: { folders: 3, templates: 3 },
          },
        ]);
      if (path.endsWith('/initialize')) return Promise.resolve({});
      if (path.endsWith('/folders')) return Promise.resolve(folders);
      if (path.endsWith('/signatures')) return Promise.resolve([]);
      if (path === '/catalog')
        return Promise.resolve([
          {
            key: 'ORDER_CONFIRMATION',
            senderKey: 'ORDERS',
            name: template.name,
            variables: [],
          },
        ]);
      if (path.includes('/templates?'))
        return Promise.resolve({
          items: [
            {
              id: 't1',
              name: template.name,
              subject: template.subject,
              published: true,
              updatedAt: new Date().toISOString(),
            },
          ],
          total: 1,
        });
      if (path.endsWith('/templates/t1/draft-targets'))
        return Promise.resolve({
          purpose: 'ORDER_CONFIRMATION',
          targets: [
            {
              id: 't1',
              folderId: 'f1',
              folderName: 'Círculo 1',
              revision: 1,
              current: true,
            },
            {
              id: 't2',
              folderId: 'f2',
              folderName: 'Círculo 2',
              revision: 3,
              current: false,
            },
          ],
        });
      if (path.endsWith('/templates/t1/drafts') && method === 'PATCH') {
        multiBody = body;
        return Promise.resolve({
          template: { ...template, revision: 2 },
          updated: [
            { id: 't1', folderName: 'Círculo 1', revision: 2 },
            { id: 't2', folderName: 'Círculo 2', revision: 4 },
          ],
        });
      }
      if (path.endsWith('/templates/t1')) return Promise.resolve(template);
      return Promise.reject(new Error('Ruta inesperada: ' + path));
    });
    Object.assign(dom.window, {
      CRONOX_API: { admin: { mailRequest: api } },
      confirm: () => true,
    });
    dom.window.eval(read('assets/admin-mail-document.js'));
    dom.window.eval(read('assets/admin-mails.js'));
    const mails = (
      dom.window as unknown as {
        CRONOX_MAILS: { load: () => Promise<void> };
      }
    ).CRONOX_MAILS;
    const click = async (selector: string) => {
      const element = dom.window.document.querySelector(
        selector,
      ) as HTMLButtonElement;
      expect(element).not.toBeNull();
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await mails.load();
    await click('[data-mail-action=account]');
    await click('[data-mail-action=circle]');
    await click('[data-mail-action=edit]');
    await click('[data-mail-action=save]');

    const modal = dom.window.document.querySelector('.mail-save-modal')!;
    expect(modal.textContent).toContain(
      '¿Dónde quieres guardar estos cambios?',
    );
    expect(modal.textContent).toContain('Círculo 1');
    expect(modal.textContent).toContain('Círculo 2');
    expect(modal.textContent).not.toContain('Círculo 3');
    const current = modal.querySelector(
      '[data-draft-target="t1"]',
    ) as HTMLInputElement;
    const second = modal.querySelector(
      '[data-draft-target="t2"]',
    ) as HTMLInputElement;
    expect(current.checked).toBe(true);
    expect(current.disabled).toBe(true);
    expect(second.checked).toBe(false);
    second.checked = true;
    await click('[data-mail-action=save-selected]');

    const submitted = multiBody as {
      subject: string;
      preheader: string;
      document: { blocks: Array<{ type: string; src?: string }> };
      targets: Array<{ id: string; revision: number }>;
    };
    expect(submitted.targets).toEqual([
      { id: 't1', revision: 1 },
      { id: 't2', revision: 3 },
    ]);
    expect(submitted).toMatchObject({
      subject: 'Confirmación',
      preheader: 'Gracias por tu compra',
    });
    expect(submitted.document.blocks[0]).toEqual(
      expect.objectContaining({
        type: 'orderItems',
        labels: { empty: 'Sin artículos' },
      }),
    );
    expect(submitted.document.blocks[1]).toEqual(
      expect.objectContaining({
        type: 'image',
        src: 'https://storage.example.test/shared.png',
      }),
    );
    expect(dom.window.document.querySelector('.mail-save-modal')).toBeNull();
    expect(dom.window.document.body.textContent).toContain(
      'Borrador guardado en Círculo 1 y Círculo 2.',
    );
    expect(dom.window.document.body.textContent).toContain(template.name);
    dom.window.close();
  });

  it('keeps implementation HTML out of the workflow and supports responsive, upload, reorder and shortcuts', () => {
    const html = read('admin.html');
    const script = read('assets/admin-mails.js');
    expect(html).toContain('admin-mail-document.js');
    expect(read('index.html')).not.toContain('admin-mails.js');
    expect(script).toContain('beforeunload');
    expect(script).toContain('data-edit-text');
    expect(script).toContain('data-resize');
    expect(script).toContain('data-drop-list');
    expect(script).toContain('data-preview-label');
    expect(script).toContain('orderItems');
    expect(script).toContain('orderTotals');
    expect(script).toContain('event.dataTransfer.files');
    expect(script).toContain('Opciones avanzadas');
    expect(script).not.toContain('Contenido heredado protegido');
    expect(script).not.toContain('Convertir para editar');
    expect(script).not.toContain('Este HTML no se puede convertir');
    expect(script).not.toContain('Plantilla HTML heredada');
    expect(read('assets/admin-mail-document.js')).not.toContain(
      'legacyToVisual',
    );
    expect(read('assets/admin-mails.css')).toContain(
      '@media (max-width: 780px)',
    );
  });
});
