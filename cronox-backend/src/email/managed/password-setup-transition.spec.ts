import { passwordSetupDesign } from './mail-template-documents';
import { renderMail } from './mail-renderer';
import { ManagedMailService } from './managed-mail.service';
import { EmailSenderKey } from '../email.types';
const original = { blocks: [{ type: 'section', background: '#174f42', columns: [[
  { type: 'heading', text: 'Tu cuenta ha sido creada', color: '#ffdd44' },
  { type: 'text', text: 'Tu compra ya está asociada a tu nueva cuenta.' },
  { type: 'button', text: 'Activar cuenta', url: '{{actionUrl}}' },
]] }] };
const data = { title: 'Configura tu contraseña y consulta tu pedido', message: 'Tu pedido está asociado a tu cuenta CRONOX.',
  orderId: '42', actionUrl: 'https://example.test/reset#token=fixture', recoveryUrl: 'https://example.test/recuperar-contrasena',
  actionLabel: 'Configurar contraseña', subject: 'CRONOX · Configura tu contraseña y consulta tu pedido' };
describe('compatible password purpose design transition', () => {
  it('clones layout/colors and replaces obsolete copy, adding order/recovery without overwriting the source', () => {
    const before = JSON.stringify(original);
    const doc: any = passwordSetupDesign(original, 'PASSWORD_SETUP_EXISTING_ACCOUNT');
    expect(doc.blocks[0].background).toBe('#174f42');
    expect(doc.blocks[0].columns[0][0].color).toBe('#ffdd44');
    const rendered = renderMail(doc, data.subject, '', 'PASSWORD_SETUP_EXISTING_ACCOUNT', data, undefined, true);
    expect(rendered.html).toContain(data.message); expect(rendered.html).toContain('#42');
    expect(rendered.html).toContain(data.actionUrl); expect(rendered.html).toContain(data.recoveryUrl);
    expect(rendered.html).not.toMatch(/cuenta ha sido creada|nueva cuenta|\{\{/i);
    expect(JSON.stringify(original)).toBe(before);
  });
  it('can read an existing published design through the new purpose without writing or republishing it', async () => {
    const snapshot: any = { senderKey: 'NOREPLY', purpose: 'INITIAL_PASSWORD_SETUP', document: original, subject: 'Tu cuenta ha sido creada', textOverride: 'Hemos creado tu nueva cuenta' };
    const db = { emailPublication: { findUnique: jest.fn(async ({ where }: any) => where.senderKey_purpose.purpose === 'INITIAL_PASSWORD_SETUP' ? { version: { snapshot } } : null) } };
    const service = new ManagedMailService(db as any, {} as any);
    const render = jest.spyOn(service, 'render').mockResolvedValue({ html: 'fixture', text: 'fixture', subject: data.subject } as any);
    await service.published(EmailSenderKey.NOREPLY, 'PASSWORD_SETUP_EXISTING_ACCOUNT', data);
    expect(render).toHaveBeenCalledWith(EmailSenderKey.NOREPLY, expect.objectContaining({ purpose: 'PASSWORD_SETUP_EXISTING_ACCOUNT', subject: data.subject, textOverride: null }), data, true);
    expect(snapshot.purpose).toBe('INITIAL_PASSWORD_SETUP');
    expect(snapshot.textOverride).toBe('Hemos creado tu nueva cuenta');
  });
});
