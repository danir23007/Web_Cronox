import { JSDOM } from 'jsdom';
import { APPROVED_WELCOME_TEMPLATE_ID, MAIL_LOGO_BLACK, MAIL_LOGO_WHITE, noreplyLogoBlock, withMailLogoHeader, withMailLogoHtmlHeader } from './mail-logo-header';
import { MailDocument, renderMail } from './mail-renderer';
describe('official email header', () => {
  it('reuses the reset header without duplicating it', () => {
    const doc = { blocks: [{ type: 'section', background: '#151519', columns: [[noreplyLogoBlock(), { type: 'heading', text: 'Restablece tu contraseña', padding: 0 }]] }] };
    expect(withMailLogoHeader(doc)).toEqual(doc);
    const html = renderMail(doc, 'Asunto', '', 'PASSWORD_RESET', { actionUrl: 'https://example.test/reset' }).html;
    expect(withMailLogoHtmlHeader(html)).toBe(html);
  });
  it.each(['#111111', '#f7f7f5'])('adds a single proportional logo without changing content on %s', background => {
    const doc: MailDocument = { blocks: [{ type: 'section', background, columns: [[{ type: 'heading', text: 'Título {{orderId}}', padding: 10 }, { type: 'button', text: 'Mi botón', url: '{{actionUrl}}' }]] }] };
    const next = withMailLogoHeader(doc), children = next.blocks[0].columns![0];
    expect(children[0].src).toBe(background === '#111111' ? MAIL_LOGO_WHITE : MAIL_LOGO_BLACK);
    expect(children[0].width).toBe(148);
    expect(children.slice(1)).toEqual(doc.blocks[0].columns![0]);
    expect(withMailLogoHeader(next)).toEqual(next);
  });
  it('excludes the production welcome ID alone', () => {
    const doc = { blocks: [{ type: 'heading', text: 'Bienvenida' }] };
    expect(withMailLogoHeader(doc, APPROVED_WELCOME_TEMPLATE_ID)).toBe(doc);
    expect(withMailLogoHeader(doc, 'cmuh06mt00007l2xxtzbl2ri8').blocks).toHaveLength(2);
  });
  it('replaces a legacy HTML text logo in place while preserving the order number and body', () => {
    const body = '<div>Buenas noticias. Tu pedido está en camino.</div><p>{{message}}</p><a href="{{orderUrl}}">Ver pedido</a>';
    const original = `<table bgcolor="#111111"><tr><td><div>CRONOX</div></td><td align="right">#{{orderId}}</td></tr></table>${body}`;
    const updated = withMailLogoHtmlHeader(original), dom = new JSDOM(updated).window.document;
    expect(dom.querySelectorAll('img')).toHaveLength(1);
    expect(dom.querySelector('img')?.getAttribute('src')).toBe(MAIL_LOGO_WHITE);
    expect(dom.querySelector('img')?.closest('td')?.getAttribute('width')).toBe('148');
    expect(updated).toContain('<td align="right">#{{orderId}}</td>');
    expect(updated).toContain(body);
    expect(updated).not.toContain('<div>CRONOX</div>');
    expect(withMailLogoHtmlHeader(updated)).toBe(updated);
  });
  it('replaces the visual order brand and keeps both header columns', () => {
    const doc = { blocks: [{ type: 'columns', padding: 0, background: '#111111', columns: [[{ type: 'heading', text: 'CRONOX', padding: 4 }], [{ type: 'text', text: '#{{orderId}}', align: 'right' }]] }] };
    const next = withMailLogoHeader(doc);
    expect(next.blocks[0].columns[0][0].type).toBe('image');
    expect(next.blocks[0].columns[1]).toEqual(doc.blocks[0].columns[1]);
    expect(next.blocks[0]).toHaveProperty('orderHeader', true);
    expect(withMailLogoHeader(next)).toEqual(next);
  });
});
