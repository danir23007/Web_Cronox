import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_PURPOSES, variablesFor } from './mail-catalog';
import { editableDraft, editorCopy, markEditableDocument, PASSWORD_SETUP_COPY } from './mail-editor-content';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { renderMail } from './mail-renderer';
import { mailPreviewData, welcomeDocument } from './welcome-design';
import * as previews from './welcome-design';
import { ManagedMailService } from './managed-mail.service';
import { EMAIL_TEMPLATE_FILE, EmailSenderKey } from '../email.types';

describe('complete editable mail and isolated purpose previews', () => {
  const service = () => {
    const db = { emailTemplateFolder: { findFirst: jest.fn().mockResolvedValue({ id: 'folder' }) } };
    const transport = { sendMail: jest.fn() };
    return { db, transport, mail: new ManagedMailService(db as any, transport as any) };
  };
  it.each(MAIL_PURPOSES)('$key resolves every offered variable and all existing document formats', async purpose => {
    const t = service();
    const original = { blocks: [{ type: 'html', html: readFileSync(join(__dirname, '../templates', EMAIL_TEMPLATE_FILE[purpose.template]), 'utf8') }] };
    const vocabulary = { blocks: [{ type: 'text', text: variablesFor(purpose.key).map(key => `{{${key}}}`).join('\n') }] };
    const documents = [structuredDocumentForPurpose(purpose.key), original, vocabulary,
      ...(purpose.key === 'NEWSLETTER_WELCOME' ? [welcomeDocument(), welcomeDocument(false)] : [])];
    for (const document of documents) {
      const dto: any = { name: 'Guardada', folderId: 'folder', subject: purpose.subject, preheader: 'Para {{title}}',
        document, purpose: purpose.key, signatureMode: 'none' };
      const before = JSON.stringify(dto);
      const result = await t.mail.preview(purpose.senderKey, dto);
      expect(result.warnings).toEqual([]);
      expect(result.html + result.text + result.subject + result.preheader).not.toMatch(/\{\{[^}]*\}\}/);
      expect(result.html).not.toContain('CRONOXEDITSTART');
      expect(JSON.stringify(dto)).toBe(before);
      const edit = await t.mail.preview(purpose.senderKey, { ...dto, view: 'edit' });
      expect(edit.bindings!.length).toBeGreaterThan(0);
      expect(edit.html).toContain('CRONOXEDITSTART');
    }
    expect(t.transport.sendMail).not.toHaveBeenCalled();
  });
  it('keeps customized HTML, styling and different account copy without writing storage', () => {
    for (const purpose of Object.keys(PASSWORD_SETUP_COPY)) {
      const original = { purpose, subject: 'Asunto propio', document: { blocks: [{ type: 'html', html:
        '<table bgcolor="#123456"><tr><td><h1>{{title}}</h1><p>{{message}}</p><p>Texto exclusivo del círculo {{orderId}}</p><img src="https://example.test/logo.png"></td></tr></table>' }] } };
      const raw = JSON.stringify(original), result = editableDraft(original);
      expect(result.subject).toBe('Asunto propio');
      expect(result.document.blocks[0].html).toContain(editorCopy(purpose).message);
      expect(result.document.blocks[0].html).toContain('Texto exclusivo del círculo {{orderId}}');
      expect(result.document.blocks[0].html).toContain('bgcolor="#123456"');
      expect(JSON.stringify(original)).toBe(raw);
    }
  });
  it('preserves conditional source offsets and changes only an edited HTML text', () => {
    const source = '<p>{{#if actionUrl}}Mi &amp; texto {{orderId}}{{else}}Sin enlace{{/if}}</p>';
    const marked = markEditableDocument({ blocks: [{ type: 'html', html: source }] });
    const binding = marked.bindings.find(b => b.value.includes('Mi &amp;'))!;
    expect(source.slice(binding.start, binding.end)).toBe(binding.value);
    const edited = source.slice(0, binding.start) + 'Mi texto personalizado {{orderId}}' + source.slice(binding.end);
    expect(edited).toBe('<p>{{#if actionUrl}}Mi texto personalizado {{orderId}}{{else}}Sin enlace{{/if}}</p>');
  });
  it('renders all newsletter access cases while retaining both editable branches', async () => {
    const t = service();
    const dto: any = { name: 'Acceso', folderId: 'folder', subject: 'Accede', purpose: 'NEWSLETTER_ACCESS', signatureMode: 'none', document: structuredDocumentForPurpose('NEWSLETTER_ACCESS') };
    const expanded = editableDraft(dto);
    expect(JSON.stringify(expanded)).toContain('{{#if accountEligible}}');
    for (const scenario of ['eligible', 'registration', 'without-password'] as const) {
      const edit = await t.mail.preview(EmailSenderKey.NOREPLY, { ...dto, scenario, view: 'edit' });
      expect(edit.html).not.toContain('{{#if');
      expect(edit.html).toContain(scenario === 'registration' ? 'Esta solicitud no ha creado ninguna cuenta.' : 'caduca en 20 minutos');
      const result = await t.mail.preview(EmailSenderKey.NOREPLY, { ...dto, scenario });
      expect(result.warnings).toEqual([]);
      expect(result.html).not.toContain('{{');
      expect(result.text).toContain(scenario === 'registration' ? 'Esta solicitud no ha creado ninguna cuenta.' : 'caduca en 20 minutos');
      expect(result.text.includes('Ejemplo-No-Valido-1042')).toBe(scenario === 'eligible');
    }
  });
  it('names a missing supported sample instead of silently reporting a normal preview', async () => {
    const data = mailPreviewData('ORDER_SHIPPED'); delete data.trackingNumber;
    const spy = jest.spyOn(previews, 'mailPreviewData').mockReturnValue(data);
    try {
      const t = service();
      const result = await t.mail.preview(EmailSenderKey.ORDERS, { name: 'Envío', folderId: 'folder', subject: 'Pedido', purpose: 'ORDER_SHIPPED', signatureMode: 'none', preheader: '', document: structuredDocumentForPurpose('ORDER_SHIPPED') as any });
      expect(result.warnings).toContain('Falta un dato ficticio para {{trackingNumber}}.');
    } finally { spy.mockRestore(); }
  });
  it('resolves the complete campaign vocabulary without a transactional purpose', async () => {
    const t = service();
    const result = await t.mail.preview(EmailSenderKey.INFO, { name: 'Campaña guardada', folderId: 'folder', subject: 'Para {{customerFullName}}', preheader: '', signatureMode: 'none',
      document: { blocks: [{ type: 'text', text: variablesFor(null).map(key => `{{${key}}}`).join('\n') }] } });
    expect(result.warnings).toEqual([]);
    expect(result.html + result.subject).not.toContain('{{');
    expect(result.subject).toBe('Para Lucía Martín');
  });
  it('includes the selected/default signature with the same rendering rules as sending', async () => {
    const signature = { blocks: [{ type: 'text', text: 'Firma exclusiva de Soporte' }] };
    const db = { emailTemplateFolder: { findFirst: jest.fn().mockResolvedValue({ id: 'folder' }) },
      emailSenderProfile: { findUnique: jest.fn().mockResolvedValue({ defaultSignatureId: 'sig' }) },
      emailSignature: { findFirst: jest.fn().mockResolvedValue({ document: signature }) } };
    const t = new ManagedMailService(db as any, {} as any);
    for (const signatureMode of ['default', 'selected'] as const) {
      const result = await t.preview(EmailSenderKey.SUPPORT, { name: 'Con firma', folderId: 'folder', subject: 'Soporte', preheader: '', signatureMode, signatureId: 'sig',
        document: { blocks: [{ type: 'text', text: 'Texto propio del correo' }] } });
      expect(result.text).toContain('Firma exclusiva de Soporte');
      expect(result.text).toContain('Texto propio del correo');
      expect(result.warnings).toEqual([]);
    }
  });
  it('uses safe destinations for sensitive example links and leaves real rendering data alone', () => {
    for (const purpose of MAIL_PURPOSES) {
      const sample = mailPreviewData(purpose.key);
      for (const key of ['actionUrl', 'orderUrl', 'trackingUrl', 'recoveryUrl']) expect(new URL(String(sample[key])).hostname).toBe('example.test');
    }
    const draft = editableDraft({ purpose: 'PASSWORD_SETUP_EXISTING_ACCOUNT', document: structuredDocumentForPurpose('PASSWORD_SETUP_EXISTING_ACCOUNT') });
    const real = renderMail(draft.document, 'Pedido {{orderId}}', '', draft.purpose,
      { orderId: 'REAL-9821', actionUrl: 'https://cronox.es/real-token', recoveryUrl: 'https://cronox.es/real-recovery' }, undefined, true);
    expect(real.html).toContain('https://cronox.es/real-token');
    expect(real.subject).toBe('Pedido REAL-9821');
    expect(real.html).not.toMatch(/example.test|CRX-1042|Lucía/);
  });
});
