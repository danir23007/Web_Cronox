import { renderMail, cleanMailHtml, effectiveMailHtml } from './mail-renderer';
import { adaptFirstPartyDocument } from './mail-template-documents';
import { welcomeData, welcomeDocument, WELCOME_MESSAGE, WELCOME_SUBJECT } from './welcome-design';
import { parseDocument } from 'htmlparser2';

describe('approved welcome imported HTML email', () => {
  const render = (code?: string) => renderMail(welcomeDocument(), WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', welcomeData(code), undefined, true);
  it('preserves the explicit format through JSON reopen/adaptation and renders one continuous background', () => {
    const document = JSON.parse(JSON.stringify(welcomeDocument()));
    expect(adaptFirstPartyDocument('NEWSLETTER_WELCOME', document)).toBe(document);
    const result = render('CUSTOMER-REAL-123');
    expect(result.subject).toBe(WELCOME_SUBJECT);
    expect(result.html.match(/background="https:[^"]+"/g)).toHaveLength(1);
    expect(result.html).toContain('background-image:url(');
    expect(result.html).toContain('welcome-title');
    expect(result.html).toContain('@media(max-width:480px)');
    expect(result.html).toContain('.welcome-backdrop{background-size:560px 100%!important}');
    expect(result.html).toContain('class="welcome-backdrop"');
    expect(result.html.match(/Tu cuenta está lista\./g)).toHaveLength(1);
    expect(result.html.match(/Aquí empieza tu recorrido/g)).toHaveLength(1);
    expect(result.html).toContain('Como privilegio de iniciación,<br');
    expect(result.text).toContain('Como privilegio de iniciación,');
    expect(result.html).not.toMatch(/CRX-EJEMPLO|BIENVENIDA10|CÓDIGO DE EJEMPLO|Código de ejemplo|¡Gracias por unirte/);
    expect(result.text).toContain('CUSTOMER-REAL-123');
    expect(result.text + result.html).not.toContain('Mantén pulsado');
    expect(result.html).toContain('padding:29px 25px 30px;');
    expect(result.html).toMatch(/class="welcome-code"[^>]*>CUSTOMER-REAL-123<\/td>/);
    expect(result.html).not.toMatch(/onclick|onmousedown|navigator\.clipboard|user-select/);
    expect(result.text).toContain(WELCOME_MESSAGE);
    expect(result.text).toContain('https://cronox.es/');
    expect(result.text).toContain('mailto:support@cronox.es');
    expect(result.text).toContain('La cara B del ser humano');
  });
  it('preserves a validated light-only preference without trusting imported head CSS or changing other mail', () => {
    const reopened = JSON.parse(JSON.stringify(welcomeDocument()));
    expect(reopened.page.colorScheme).toBe('light-only');
    // The existing light-only shell remains available without the opt-in canvas.
    delete reopened.page.canvas;
    const result = renderMail(reopened, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME');
    expect(result.html).toContain('<meta name="color-scheme" content="light only">');
    expect(result.html).toContain(':root{color-scheme:light dark;}');
    expect(result.html).not.toContain('background-color:#111111');
    expect(result.html.match(/<table\b[^>]*width="600"/g)).toHaveLength(1);
    expect(result.html).not.toContain('display:none'); // No empty hidden preheader.
    expect(result.html).toContain('color:#080808;');
    expect(result.html).not.toContain('color-scheme:light only;');
    expect(effectiveMailHtml(result.html)).toContain('<meta name="color-scheme" content="light only">');
    expect(result.html).toContain('html,body,.mail-html-page{margin:0!important;padding:0!important;width:100%!important;background-color:#aaa9a6!important;}');
    expect(result.html).toContain('<body class="mail-html-page" bgcolor="#aaa9a6"');
    expect(effectiveMailHtml(result.html)).toContain('background-color:#aaa9a6!important;');
    expect(effectiveMailHtml(result.html)).toContain('<body class="mail-html-page" bgcolor="#aaa9a6"');
    const unsafeHead = '<html><head><meta name="color-scheme" content="light only"><style>body{display:none}</style><script>bad()</script></head><body><p>Safe</p></body></html>';
    expect(effectiveMailHtml(unsafeHead)).not.toMatch(/body\{display:none\}|<script/);
    const unsafeBackground = unsafeHead.replace('<body>', '<body bgcolor="#aaa9a6;position:fixed" style="background-color:#ffffff;padding:16px">');
    expect(effectiveMailHtml(unsafeBackground)).toContain('<body class="mail-html-page" bgcolor="#111111"');
    expect(effectiveMailHtml(unsafeBackground)).not.toContain('position:fixed');
    expect(effectiveMailHtml('<p>Normal</p>')).not.toContain('content="light only"');
    const normal = { ...reopened, page: { width: 600, background: '#aaa9a6' } };
    expect(renderMail(normal, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME').html).not.toContain('content="light only"');
    expect(renderMail({ blocks: [{ type: 'text', text: 'Normal' }] }, 'Subject').html).not.toContain('content="light only"');
    expect(() => renderMail({ ...reopened, page: { ...reopened.page, colorScheme: 'light;position:fixed' } }, WELCOME_SUBJECT)).toThrow(/color/);
    for (const approved of [true, false]) {
      const fallback = renderMail(welcomeDocument(approved), WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME');
      expect(fallback.html + fallback.text).not.toContain('Mantén pulsado');
    }
  });
  it('restores the body-painted welcome canvas without changing its inner design or trusting CSS', () => {
    const doc = JSON.parse(JSON.stringify(welcomeDocument()));
    expect(doc.page.canvas).toBe('body');
    expect(adaptFirstPartyDocument('NEWSLETTER_WELCOME', doc)).toBe(doc);
    const current = renderMail(doc, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', welcomeData('CUSTOMER-123'));
    const previous = JSON.parse(JSON.stringify(doc)); delete previous.page.canvas;
    const before = renderMail(previous, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', welcomeData('CUSTOMER-123'));
    const bodyContent = (html: string) => html.match(/<body\b[^>]*>([\s\S]*)<\/body>/)![1];
    expect(bodyContent(current.html)).toBe(bodyContent(before.html));
    expect(current.text).toBe(before.text);
    expect(current.html).toContain('<html lang="es"><head>');
    expect(current.html).toContain('<meta name="color-scheme" content="light only">');
    expect(current.html).not.toContain(':root{color-scheme:light dark;}');
    expect(current.html).toContain('<body class="mail-html-page mail-body-canvas" bgcolor="#aaa9a6" style="margin:0;background:#aaa9a6;color:#080808;">');
    const effective = effectiveMailHtml(current.html);
    expect(effective).toContain('<html lang="es"><head>');
    expect(effective).toContain('mail-body-canvas');
    expect(effective).toContain('style="margin:0;background:#aaa9a6;color:#080808;"');
    expect(effective).toContain('<meta name="color-scheme" content="light only">');
    expect(effective).not.toContain(':root{color-scheme:light dark;}');
    expect(effectiveMailHtml('<html><head><meta name="color-scheme" content="light only"><style>body{position:fixed}</style></head><body class="mail-body-canvas" bgcolor="red;position:fixed"><p>Safe</p></body></html>')).not.toContain('position:fixed');
    for (const canvas of ['body;position:fixed', 'page', {}, true])
      expect(() => renderMail({ ...doc, page: { ...doc.page, canvas } }, WELCOME_SUBJECT)).toThrow(/exterior/);
    expect(() => renderMail({ ...doc, page: { ...doc.page, colorScheme: undefined } }, WELCOME_SUBJECT)).toThrow(/exterior/);
    expect(welcomeDocument(false).page?.canvas).toBeUndefined();
  });
  it('blocks an oversized final welcome after substitution without restricting other mail', () => {
    const data = { ...welcomeData('CUSTOMER-REAL-123'), message: 'A'.repeat(80 * 1024) };
    expect(() => renderMail(welcomeDocument(), WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', data)).toThrow(/WELCOME_HTML_SIZE_LIMIT/);
    expect(() => renderMail({ blocks: [{ type: 'html', html: '<p>' + 'A'.repeat(81 * 1024) + '</p>' }] }, 'Other')).not.toThrow();
  });
  it('places both contacts, the letter-size Instagram mark and side logos in the same centered row', () => {
    const parsed = parseDocument(render('CUSTOMER-REAL-123').html);
    const elements: any[] = [];
    const visit = (node: any) => { if (node.type === 'tag') elements.push(node); node.children?.forEach(visit); };
    visit(parsed);
    const icon = elements.find(node => node.name === 'img' && node.attribs.class === 'welcome-instagram');
    const row = icon.parent.parent.parent;
    const cells = row.children.filter((node: any) => node.name === 'td');
    expect(cells).toHaveLength(6);
    expect(cells.every((cell: any) => cell.attribs.valign === 'middle')).toBe(true);
    expect(row.parent.attribs.align).toBe('center');
    for (const cell of [cells[2], cells[4]]) {
      expect(cell.attribs.class).toBe('welcome-footer');
      expect(cell.attribs.style).toContain('line-height:16px');
      expect(cell.children[0].attribs.style).toContain('display:block');
      expect(cell.children[0].attribs.style).toContain('color:#ffffff');
    }
  });
  it.each([undefined, '', ' ', 'CRX-EJEMPLO', 'BIENVENIDA10', 'CÓDIGO DE EJEMPLO'])('blocks rendering for unavailable or example code %s', code => {
    expect(() => render(code)).toThrow(/personal/);
  });
  it('keeps data escaped, accommodates a long code and only uses stable HTTPS images', () => {
    const result = render('PERSONAL-' + 'A'.repeat(120) + '<script>alert(1)</script>');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).toContain('overflow-wrap:anywhere');
    const images = [...result.html.matchAll(/(?:src|background)="([^"]+)"/g)].map(match => match[1]);
    expect(images).toHaveLength(6);
    for (const url of images) { expect(url).toMatch(/^https:\/\//); expect(new URL(url).search).toBe(''); }
    expect(result.html).not.toContain('assets/');
    expect(result.html).toContain('href="https://www.instagram.com/cronox.es/"');
    expect(result.html).toContain('href="mailto:support@cronox.es"');
    const white = require('../../../../cronox-front/assets/mail/welcome/manifest.json');
    expect(result.html).toContain(white.assets['instagram-blanco.png'].url);
    expect(result.html).not.toContain(white.assets['instagram.png'].url);
    expect(result.html).toContain(white.derivatives['fondo-cortinas-email.jpg'].url);
    expect(result.html).not.toContain(white.assets['fondo-cortinas.png'].url);
    const imageTags = [...result.html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
    expect(imageTags.every(tag => /width="\d+"/.test(tag) && /height="\d+"/.test(tag))).toBe(true);
    expect(Buffer.byteLength(result.html, 'utf8')).toBeLessThan(20 * 1024);
    expect(result.html).toMatch(/href="https:\/\/www\.instagram\.com\/cronox\.es\/" style="[^"]*color:#ffffff;[^\"]*">cronox.es<\/a>/);
    expect(result.html).toMatch(/href="mailto:support@cronox\.es" style="[^"]*color:#ffffff;/);
  });
  it('keeps message mandatory, rejects unsigned format variants and prevents a duplicate footer signature', () => {
    const doc = welcomeDocument();
    const withoutMessage = { ...doc, blocks: [{ ...doc.blocks[0], html: doc.blocks[0].html!.replace('{{message}}', '') }] };
    expect(() => renderMail(withoutMessage, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', welcomeData('VISTA-PREVIA-NO-VALIDO'), undefined, true)).toThrow(/message/);
    expect(() => renderMail({ ...doc, schemaVersion: 0 }, WELCOME_SUBJECT)).toThrow(/no válido/);
    expect(() => renderMail({ ...doc, blocks: [...doc.blocks, { type: 'spacer' }] }, WELCOME_SUBJECT)).toThrow(/no válido/);
    expect(() => renderMail(doc, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME', welcomeData('VISTA-PREVIA-NO-VALIDO'), { blocks: [] })).toThrow(/Sin firma/);
  });
  it('never trusts imported HTML/CSS, preserves only fixed responsive classes and keeps the Correo shell responsive', () => {
    const html = '<script>alert(1)</script><style>body{display:none}</style><p class="welcome-copy evil" onclick="alert(1)" style="position:fixed;color:#080808">{{message}}</p><img src="file:///secret"><a href="javascript:alert(1)">Link</a>';
    const cleaned = cleanMailHtml(html, true);
    expect(cleaned).not.toMatch(/<script|<style|onclick|position|class="[^"]*evil|file:|javascript:/);
    expect(cleaned).toContain('class="welcome-copy"');
    expect(cleanMailHtml('<td style="padding:0 32px 30px;margin:0 auto;color:#080808;position:fixed;">Safe spacing</td>')).toContain('padding:0 32px 30px');
    expect(cleanMailHtml('<img src="https://example.test/logo.png" style="height:auto;border:0;position:fixed;">')).toContain('style="height:auto;border:0"');
    expect(effectiveMailHtml(render('VISTA-PREVIA-NO-VALIDO').html)).toContain('.welcome-title{font-size:40px!important');
  });
});
