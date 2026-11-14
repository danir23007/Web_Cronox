import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { join } from 'node:path';
import { EmailService } from '../email.service';
import { EmailSenderKey, EmailType } from '../email.types';
import { OrderConfirmationEmailMapper } from '../order-confirmation-email.mapper';
import { Decimal } from '@prisma/client/runtime/library';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { editableDraft } from './mail-editor-content';
import { mailPreviewData } from './welcome-design';
import { renderMail, MailDocument } from './mail-renderer';
import { ManagedMailService } from './managed-mail.service';
import { mutedTaxColor, prepareOrderConfirmationDocument, prepareOrderConfirmationHtml, ORDER_LOGO_LIGHT, ORDER_LOGO_DARK, ORDER_TAX_LABEL } from './order-confirmation-design';

const legacy = readFileSync(join(__dirname, '../templates/order-confirmation.hbs'), 'utf8');
const sample = mailPreviewData('ORDER_CONFIRMATION');
describe('confirmation presentation without changing financial or publication data', () => {
  it('exports email PNGs with the official aspect ratio and an opaque light fallback canvas', async () => {
    const folder = join(__dirname, '../../../../cronox-front/assets/mail/order-confirmation');
    for (const file of ['logo-light.png', 'logo-dark.png']) {
      const metadata = await sharp(join(folder, file)).metadata();
      expect(metadata.format).toBe('png'); expect(metadata.width).toBe(522); expect(metadata.height).toBe(135);
    }
    const { data, info } = await sharp(join(folder, 'logo-light.png')).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect([...data.subarray(0, 3)]).toEqual([247, 247, 245]);
  });
  it('projects existing blocks and HTML without changing custom content or stored objects', () => {
    const raw = { purpose: 'ORDER_CONFIRMATION', subject: 'Mi asunto', document: { blocks: [{ type: 'html', html: legacy.replace('Gracias por visitar Cronox', 'Mi agradecimiento personalizado') }] } };
    const before = JSON.stringify(raw), prepared = editableDraft(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(prepared.document.blocks[0].html).toContain('Mi agradecimiento personalizado');
    expect(prepared.document.blocks[0].html).toContain('{{orderUrl}}');
    expect(prepared.document.blocks[0].html).toContain('{{#if savingsFormatted}}');
    expect(prepared.document.blocks[0].html).toContain(ORDER_TAX_LABEL);
    expect(prepareOrderConfirmationHtml(prepared.document.blocks[0].html)).toBe(prepared.document.blocks[0].html);
    const custom = { blocks: [{ type: 'logo', src: 'https://example.test/custom.png', alt: 'Mi logo' }, { type: 'text', text: 'Mi texto propio' }] };
    expect(prepareOrderConfirmationDocument(custom)).toEqual(custom);
  });
  it.each(['blocks', 'html'])('keeps one responsive header, the same figures and compact section gaps (%s)', format => {
    const document = format === 'blocks' ? structuredDocumentForPurpose('ORDER_CONFIRMATION')! : { blocks: [{ type: 'html', html: legacy }] };
    const result = renderMail(document, 'Pedido {{orderId}}', '', 'ORDER_CONFIRMATION', sample, undefined, true);
    expect(result.html).toContain(ORDER_LOGO_LIGHT); expect(result.html).toContain(ORDER_LOGO_DARK);
    expect(result.html.match(/alt="CRONOX"/g)).toHaveLength(2); // complementary CSS visibility, checked in browser
    expect(result.html).toContain('prefers-color-scheme:dark');
    expect(result.html).toContain('mso-hide:all');
    expect(result.html).toContain('Impuestos (ya incluidos)');
    for (const key of ['subtotalFormatted', 'taxesFormatted', 'shippingFormatted', 'totalFormatted']) expect(result.html).toContain(String(sample[key]));
    expect(result.html).toContain('align="right"');
    if (format === 'blocks') {
      const blocks = (document as MailDocument).blocks;
      expect(blocks[1].size).toBe(6); expect(blocks[3].size).toBe(6);
      expect(blocks[0].paddingBottom).toBe(6); expect(blocks[2].paddingTop).toBe(6);
      expect(result.html).toContain('class="order-header-cell"');
    } else expect(result.html).not.toContain('height:18px;line-height:18px');
    expect(result.html).not.toContain('{{');
  });
  it.each(['#f7f7f5', '#1b1b1b'])('selects an accessible muted tax color for %s', background => {
    expect(mutedTaxColor(background)).toBe(background === '#f7f7f5' ? '#666666' : '#b8b8b8');
  });
  it('uses the real automatic fallback, mapper and sender with an in-memory transport', async () => {
    const order: any = { id: 1042, userId: null, customerEmail: 'lucia@example.test', user: null, subtotal: new Decimal('69.90'), taxAmount: new Decimal('12.13'), total: new Decimal('69.80'), shippingCost: 490, discountCents: 500,
      shippingAddr: { fullName: 'Lucía Martín', line1: 'Calle Ejemplo 12', city: 'Madrid', postalCode: '28001', country: 'ES' }, shippingMethod: { name: 'Envío estándar' },
      items: [{ title: 'Camiseta CRONOX (M)', quantity: 2, unitPrice: new Decimal('34.95'), lineTotal: new Decimal('69.90'), product: { name: 'Camiseta CRONOX', variants: [{ size: 'M' }] } }] };
    const mapped = new OrderConfirmationEmailMapper().map(order);
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'memory-only', accepted: ['lucia@example.test'] });
    const managed = { published: jest.fn().mockResolvedValue(null) };
    const mail = new EmailService({ sendMail } as any, managed as any);
    await mail.send({ type: EmailType.ORDER_CONFIRMATION, to: 'lucia@example.test', subject: 'Confirmación de pedido', templateData: mapped });
    expect(managed.published).toHaveBeenCalledWith(EmailSenderKey.ORDERS, 'ORDER_CONFIRMATION', expect.objectContaining({ orderId: '1042' }));
    const sent = sendMail.mock.calls[0][1];
    expect(sent.html).toContain(ORDER_LOGO_LIGHT); expect(sent.html).toContain(ORDER_TAX_LABEL);
    expect(sent.html).toContain(mapped.taxesFormatted); expect(sent.html).toContain(mapped.totalFormatted);
    expect(sent.html).toContain(mapped.orderUrl);
    expect(sent.html).not.toContain('{{');
  });
  it('renders the selected immutable publication without replacing its custom copy', async () => {
    const snapshot = { senderKey: 'ORDERS', purpose: 'ORDER_CONFIRMATION', subject: 'Tu pedido {{orderId}}', preheader: '', signatureMode: 'none', signatureId: null,
      document: { blocks: [{ type: 'html', html: legacy.replace('Gracias por visitar Cronox', 'Saludo de la versión publicada') }] } };
    const before = JSON.stringify(snapshot);
    const db = { emailPublication: { findUnique: jest.fn().mockResolvedValue({ version: { snapshot } }) } };
    const service = new ManagedMailService(db as any, {} as any);
    const result = await service.published(EmailSenderKey.ORDERS, 'ORDER_CONFIRMATION', sample);
    expect(result!.html).toContain('Saludo de la versión publicada');
    expect(result!.html).toContain(ORDER_LOGO_LIGHT);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(db.emailPublication.findUnique).toHaveBeenCalledTimes(1);
  });
});
