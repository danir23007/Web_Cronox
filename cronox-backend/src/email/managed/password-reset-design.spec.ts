import Handlebars from 'handlebars';
import { JSDOM } from 'jsdom';
import { EmailService } from '../email.service';
import { PASSWORD_RESET_COPY as copy, PASSWORD_RESET_LOGO, PASSWORD_RESET_TEXT, passwordResetDocument } from './password-reset-design';
import { renderMail } from './mail-renderer';

describe('Spanish password reset design', () => {
  const actionUrl = 'https://example.test/recuperar-contrasena?source=test&case=1#token=simulado';

  it('renders editable fixed copy, one official logo and one unchanged reset action', () => {
    const document = passwordResetDocument();
    expect(JSON.stringify(document).match(/\{\{[^}]+\}\}/g)).toEqual(['{{actionUrl}}']);
    const rendered = renderMail(document, copy.subject, copy.preheader, 'PASSWORD_RESET', { actionUrl }, undefined, true);
    expect(rendered.html.match(/<img\b/g)).toHaveLength(1);
    expect(rendered.html).toContain(PASSWORD_RESET_LOGO);
    expect(rendered.html).toContain('alt="CRONOX"');
    expect(rendered.html.match(/<a\b/g)).toHaveLength(1);
    expect(new JSDOM(rendered.html).window.document.querySelector('a')?.getAttribute('href')).toBe(actionUrl);
    for (const text of [copy.title, copy.message, copy.actionLabel, copy.validity, copy.notice]) expect(rendered.html).toContain(text);
    expect(Handlebars.compile(PASSWORD_RESET_TEXT, { noEscape: true })({ actionUrl })).toContain(actionUrl);
    expect(rendered.html).not.toMatch(/Use the secure link|Reset password|\{\{/);
  });

  it.each([1, 2, 3, 4, 5, null])('uses the same Spanish fallback without altering the real action (circle %s)', async circle => {
    const transport = { sendMail: jest.fn().mockResolvedValue({ messageId: 'simulated', accepted: ['fixture@example.test'] }) };
    const managed = { recipientCircle: jest.fn().mockResolvedValue(circle), published: jest.fn().mockResolvedValue(null) };
    const service = new EmailService(transport as any, managed as any);
    await service.sendPasswordReset('fixture@example.test', actionUrl);
    expect(managed.published).toHaveBeenCalledWith('NOREPLY', 'PASSWORD_RESET', expect.objectContaining({ actionUrl, circleLevel: circle ?? undefined }));
    const [, mail] = transport.sendMail.mock.calls[0] as unknown as [string, any];
    expect(mail.subject).toBe(copy.subject);
    expect(mail.html).toContain(copy.preheader);
    expect(new JSDOM(mail.html).window.document.querySelector('a')?.getAttribute('href')).toBe(actionUrl);
    expect(mail.text).toBe(Handlebars.compile(PASSWORD_RESET_TEXT, { noEscape: true })({ actionUrl }));
    expect(mail.html + mail.text).not.toMatch(/Use the secure link|Reset password|\{\{/);
  });
});
