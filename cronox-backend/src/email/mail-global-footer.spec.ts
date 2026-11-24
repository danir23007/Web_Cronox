import { JSDOM } from 'jsdom';
import { composeGlobalMailFooter, footerSocials, COMMERCIAL_MAIL_PURPOSES } from './mail-global-footer';
import { composeApplicationMail, assertCommercialMailAllowed } from './mail-footer-composition';
import { mailPreferenceToken, readMailPreferenceToken } from './mail-preference-token';
import { MAIL_PURPOSES } from './managed/mail-catalog';
import { structuredDocumentForPurpose } from './managed/mail-template-documents';
import { mailPreviewData } from './managed/welcome-design';
import { renderMail, effectiveMailHtml } from './managed/mail-renderer';
import { MailPreferencesController } from './mail-preferences.controller';
import { MailboxCampaignService } from '../mailbox/mailbox-campaign.service';
import { compileMailMessage } from './mail-message';
import { simpleParser } from 'mailparser';
import { restockDeliveryOutcome } from './restock-delivery.error';

const link = 'https://cronox.es/preferencias-correo';
const compose = (html: string, purpose = 'ORDER_CONFIRMATION', text = 'Cuerpo original') =>
  composeGlobalMailFooter(html, text, { purpose, preferenceUrl: link });
const dom = (html: string) => new JSDOM(html).window.document;

describe('global email footer', () => {
  it.each(MAIL_PURPOSES.flatMap(p => (p.circles || [1, 2, 3, 4, 5]).map(circle => ({ purpose: p.key, circle, subject: p.subject }))))
  ('covers $purpose circle $circle without changing its body or publishing anything', ({ purpose, circle, subject }) => {
    const document = structuredDocumentForPurpose(purpose) || { blocks: [{ type: 'text', text: '{{message}}' }] };
    const data = mailPreviewData(purpose, circle);
    const original = renderMail(document, subject, '', purpose, data);
    const rendered = compose(original.html, purpose, original.text);
    const parsed = dom(rendered.html), footer = parsed.querySelector('.cronox-global-footer')!;
    expect(parsed.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
    expect(rendered.html.match(/data-cronox-footer-style="v1"/g)).toHaveLength(1);
    expect(footer.textContent).toContain('support@cronox.es');
    expect(footer.querySelector('img')?.getAttribute('alt')).toBe('CRONOX');
    expect(footer.querySelector('a[href="mailto:support@cronox.es"]')).not.toBeNull();
    expect(footer.querySelector('svg,script')).toBeNull();
    expect(rendered.text).toContain('Todos los derechos reservados');
    expect(footer.querySelector('a[href="mailto:support@cronox.es"]')!.parentElement!.textContent).toBe('Si tienes cualquier problema o duda, escríbenos: support@cronox.es');
    expect(rendered.text).toContain('\nSi tienes cualquier problema o duda, escríbenos: support@cronox.es\n');
    expect(footer.querySelector(`a[href="${link}"]`)?.textContent).toBe('Actualiza tus preferencias');
    expect(rendered.text).toContain(`Actualiza tus preferencias: ${link}`);
    expect(rendered.html + rendered.text).not.toMatch(/Los correos necesarios de pedidos, seguridad y acceso seguirán enviándose|Gestionar mis preferencias comerciales|Darme de baja de comunicaciones comerciales/);
  });

  it('is idempotent even after the existing editor sanitizer and keeps a human signature and header', () => {
    const source = '<html><head></head><body><div>CRONOX</div><h1>Pedido #1042</h1><p>Firma personal: Ana, Atención al cliente.</p><p>Información necesaria del pedido.</p></body></html>';
    const first = compose(source);
    const second = compose(effectiveMailHtml(first.html), 'ORDER_CONFIRMATION', first.text);
    expect(second.html.match(/data-cronox-footer-style="v1"/g)).toHaveLength(1);
    const parsed = dom(second.html);
    expect(parsed.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
    expect(parsed.querySelector('h1')?.textContent).toBe('Pedido #1042');
    expect(parsed.body.textContent).toContain('Firma personal: Ana');
    expect(parsed.querySelector('div')?.textContent).toBe('CRONOX');
    expect(second.text.match(/CRONOX · Contacto y preferencias/g)).toHaveLength(1);
  });
  it('removes exclusive old-footer containers without touching the message or quoted signature', () => {
    const old = dom(compose('<body><p>Antes</p></body>').html).querySelector('.cronox-global-footer')!.outerHTML;
    const source = `<html><body><table><tr><td><p>Cuerpo conservado</p></td></tr><tr><td height="300" style="padding:40px;"><div style="min-height:250px">${old}</div></td></tr></table><blockquote>Firma de Ana</blockquote></body></html>`;
    const result = compose(source);
    const parsed = dom(result.html), footer = parsed.querySelector('.cronox-global-footer')!;
    expect(parsed.querySelector('[height="300"]')).toBeNull();
    expect(result.html).not.toContain('min-height:250px');
    expect(parsed.querySelector('p')!.textContent).toBe('Cuerpo conservado');
    expect(parsed.querySelector('blockquote')!.textContent).toBe('Firma de Ana');
    expect(footer.parentElement!.tagName).toBe('BODY');
    expect(parsed.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
    expect(footer.getAttribute('style')).toContain('height:auto!important');
    expect([...footer.querySelectorAll('td')].every(td => td.getAttribute('valign') === 'top')).toBe(true);
    expect(footer.querySelector('[height]')).toMatchObject({ tagName: 'IMG' });
  });
  it('replaces only the known welcome contact row and preserves the tagline and message-specific support advice', () => {
    const source = '<html><body><h1>Bienvenido</h1><p>Para recuperar tu cuenta contacta con support@cronox.es.</p><img alt="La cara B del ser humano"><table><tr><td class="welcome-footer"><a href="https://www.instagram.com/cronox.es/">cronox.es</a> · <a href="mailto:support@cronox.es">support@cronox.es</a></td></tr></table></body></html>';
    const rendered = compose(source, 'NEWSLETTER_WELCOME');
    expect(rendered.html).not.toContain('class="welcome-footer"');
    expect(rendered.html).toContain('Para recuperar tu cuenta contacta con support@cronox.es.');
    expect(rendered.html).toContain('alt="La cara B del ser humano"');
  });
  it('filters placeholders and hostile URLs, without inventing TikTok or YouTube profiles', () => {
    const defaults = footerSocials({ tiktokUrl: 'https://tiktok.com/@tu_cuenta', youtubeUrl: 'https://youtube.com/@tu_cuenta' });
    expect(defaults.map(s => s.name)).toEqual(['Instagram', 'TikTok', 'YouTube']);
    expect(defaults.map(s => s.url)).toEqual(['https://www.instagram.com/cronox.es/', undefined, undefined]);
    expect(footerSocials({ instagramUrl: 'https://attacker.test/cronox', tiktokUrl: 'javascript:alert(1)', youtubeUrl: 'https://user:password@youtube.com/@name' }).every(s => !s.url)).toBe(true);
  });
  it('shows three aligned social icons, with no interaction for unconfigured profiles, and links them automatically when configured', () => {
    const footer = dom(compose('<body bgcolor="#111111">Mensaje</body>').html).querySelector('.cronox-global-footer')!;
    const icons = [...footer.querySelectorAll('img')].filter(image => image.getAttribute('alt') !== 'CRONOX');
    expect(icons.map(image => image.getAttribute('alt'))).toEqual(['Instagram', 'TikTok', 'YouTube']);
    expect(icons[0].closest('a')?.href).toBe('https://www.instagram.com/cronox.es/');
    for (const image of icons.slice(1)) {
      expect(image.closest('a,button,[onclick],[tabindex]')).toBeNull();
      expect(image.parentElement?.getAttribute('style')).toContain('cursor:default');
    }
    expect(icons.every(image => image.getAttribute('width') === '20' && image.getAttribute('style')?.includes('padding:6px 0'))).toBe(true);
    expect(footer.querySelector('td')?.getAttribute('style')).toContain('padding:14px 20px 4px');
    expect(footer.querySelector('.cronox-footer-rule')?.closest('table')?.parentElement?.getAttribute('style')).toContain('padding:0 24px 8px');
    const rule = footer.querySelector('.cronox-footer-rule')!.closest('table')!;
    expect(rule.getAttribute('width')).toBe('210');
    expect(rule.getAttribute('style')).toContain('max-width:210px');
    const support = footer.querySelector('a[href="mailto:support@cronox.es"]')!.parentElement!;
    expect(support.firstChild?.textContent).toBe('Si tienes cualquier problema o duda, escríbenos: ');
    expect(support.textContent).toBe('Si tienes cualquier problema o duda, escríbenos: support@cronox.es');
    expect(support.querySelector('br')).toBeNull();
    expect(footer.querySelector('a[href="' + link + '"]')!.parentElement!.getAttribute('style')).toContain('padding:0 24px 5px');
    const configured = composeGlobalMailFooter('<body>Mensaje</body>', '', { preferenceUrl: link, socials: { tiktokUrl: 'https://www.tiktok.com/@cronox-fixture', youtubeUrl: 'https://www.youtube.com/@cronox-fixture' } });
    for (const name of ['TikTok', 'YouTube']) expect(dom(configured.html).querySelector(`img[alt="${name}"]`)?.closest('a')?.getAttribute('href')).toContain('cronox-fixture');
  });
  it('replaces a terminal legacy brand row while keeping the brand in the header', () => {
    const html = '<html><body><h1>CRONOX</h1><p>Tu producto vuelve a estar disponible.</p><table><tr><td><div>CRONOX</div></td></tr></table></body></html>';
    const content = compose(html, 'RESTOCK');
    expect(dom(content.html).querySelector('h1')?.textContent).toBe('CRONOX');
    expect(dom(content.html).querySelector('div')?.textContent).not.toBe('CRONOX');
    expect(dom(content.html).querySelectorAll('.cronox-global-footer')).toHaveLength(1);
  });
  it('replaces a generated footer inside a quoted reply without removing the quoted message or its signature', () => {
    const original = compose('<p>Mensaje anterior</p><p>Firma personal: Ana</p>');
    const reply = compose('<p>Respuesta nueva</p><blockquote>' + original.html + '</blockquote>');
    const parsed = dom(reply.html);
    expect(parsed.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
    expect(parsed.body.textContent).toContain('Mensaje anterior');
    expect(parsed.body.textContent).toContain('Firma personal: Ana');
  });
  it('keeps explicitly light-only designs light even when a client supports dark mode', () => {
    const result = compose('<html><head><meta name="color-scheme" content="light only"></head><body bgcolor="#aaa9a6">Bienvenido</body></html>');
    expect(result.html).not.toContain('@media(prefers-color-scheme:dark)');
    expect(result.html).toContain('bgcolor="#aaa9a6"');
  });
  it.each(['#111111', '#707070', '#777777', '#808080', '#aaa9a6', '#f7f7f5', '#b1001a'])('keeps footer text at WCAG AA contrast against %s', background => {
    const result = compose(`<html><body bgcolor="${background}">Texto</body></html>`);
    const node = dom(result.html).querySelector('.cronox-global-footer a[href="mailto:support@cronox.es"]')!;
    const foreground = /color:(#[\da-f]{6})/i.exec(node.getAttribute('style')!)![1];
    const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
    expect((values[0] + .05) / (values[1] + .05)).toBeGreaterThanOrEqual(4.5);
  });
  it('updates the year using Madrid time, generates readable plain text and uses only email PNG assets', () => {
    const rendered = composeGlobalMailFooter('<html><body><p>Tu pedido está enviado.</p></body></html>', '', {
      preferenceUrl: link, now: new Date('2026-12-31T23:30:00Z'),
    });
    expect(rendered.text).toContain('Tu pedido está enviado.');
    expect(rendered.text).toContain('© 2027 CRONOX');
    expect([...dom(rendered.html).querySelectorAll('.cronox-global-footer img')].every(img => /\.png$/.test(img.getAttribute('src')!))).toBe(true);
  });
  it('preserves the complete body of a text-only future email', async () => {
    const content = await composeApplicationMail({}, { text: 'Nuevo aviso\nContenido que no existía al implementar el footer.' }, { purpose: 'FUTURE_EVENT', preview: true });
    expect(dom(content.html).body.textContent).toContain('Contenido que no existía');
    expect(content.text).toContain('Nuevo aviso\nContenido');
    const compiled = await compileMailMessage('support@cronox.es', { to: 'fixture@example.test', ...content });
    const mime = await simpleParser(compiled.raw);
    expect(mime.text).toContain('Contenido que no existía');
    expect(dom(String(mime.html)).querySelectorAll('.cronox-global-footer')).toHaveLength(1);
  });
  it('never embeds one recipient’s opt-out token in a multi-recipient message', async () => {
    const content = await composeApplicationMail({}, { text: 'Mensaje para dos personas.' }, { recipients: ['one@example.test', 'two@example.test'] });
    expect(content.html).toContain('/preferencias-correo');
    expect(content.html).not.toContain('/mailbox-unsubscribe/');
    expect(content.html).not.toContain('one@example.test');
    expect(content.html).not.toContain('two@example.test');
  });
});

describe('commercial withdrawal and preference security', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it('accepts existing encrypted campaign tokens and scoped fallback tokens, rejecting tampering', () => {
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'test';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({ test: Buffer.alloc(32, 7).toString('base64') });
    const existing = mailPreferenceToken('fixture@example.test');
    expect(readMailPreferenceToken(existing)).toBe('fixture@example.test');
    delete process.env.MAILBOX_ENCRYPTION_KEYS;
    const token = mailPreferenceToken('fixture@example.test');
    expect(token).toMatch(/^mp1_/); expect(token).not.toContain('fixture');
    expect(readMailPreferenceToken(token)).toBe('fixture@example.test');
    const bytes = Buffer.from(token.slice(4), 'base64url'); bytes[20] ^= 1;
    expect(() => readMailPreferenceToken('mp1_' + bytes.toString('base64url'))).toThrow();
    expect(() => readMailPreferenceToken('')).toThrow();
  });
  it.each([...COMMERCIAL_MAIL_PURPOSES])('blocks suppressed commercial purpose %s', async purpose => {
    const db = { mailboxSuppression: { findUnique: jest.fn().mockResolvedValue({ reason: 'UNSUBSCRIBED' }) } };
    await expect(assertCommercialMailAllowed(db, purpose, ['fixture@example.test'])).rejects.toMatchObject({ deliverySuppressed: true });
  });
  it('treats a suppressed restock as excluded before delivery, rather than an uncertain SMTP result', () => {
    expect(restockDeliveryOutcome({ deliverySuppressed: true })).toBe('FAILED');
    expect(restockDeliveryOutcome({ deliverySuppressed: true, accepted: ['fixture@example.test'] })).toBe('UNCERTAIN');
  });
  it.each(['ORDER_CONFIRMATION', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'PASSWORD_RESET', 'NEWSLETTER_ACCESS', 'EMAIL_CHANGE_AUTHORIZE', 'SUPPORT_REPLY'])
  ('does not suppress necessary purpose %s', async purpose => {
    const db = { mailboxSuppression: { findUnique: jest.fn() } };
    await expect(assertCommercialMailAllowed(db, purpose, ['fixture@example.test'])).resolves.toBeUndefined();
    expect(db.mailboxSuppression.findUnique).not.toHaveBeenCalled();
  });
  it('authenticated preferences ignore another account ID and update only the session account', async () => {
    const tx = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'owner@example.test' }), update: jest.fn() }, mailboxSuppression: { upsert: jest.fn() } };
    const controller = new MailPreferencesController({ $transaction: (fn: any) => fn(tx) } as any);
    await controller.unsubscribe({ user: { id: 7 }, body: { userId: 99, email: 'other@example.test' } } as any);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { newsletterSubscribed: false } });
    expect(tx.mailboxSuppression.upsert.mock.calls[0][0].where.email).toBe('owner@example.test');
  });
  it('existing unsubscribe endpoint validates the token before any preference write', async () => {
    const transaction = jest.fn();
    const service = new MailboxCampaignService({ $transaction: transaction } as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.unsubscribe('invalid')).rejects.toThrow(); expect(transaction).not.toHaveBeenCalled();
  });
});
