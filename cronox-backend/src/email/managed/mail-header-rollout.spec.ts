import { applyMailHeaders, headerHash, planMailHeaders } from './mail-header-rollout';
import { APPROVED_WELCOME_TEMPLATE_ID } from './mail-logo-header';

const document = (text: string) => ({ blocks: [{ type: 'heading', text }] });
function fixture() {
  const card = (id: string, senderKey: string, purpose: string) => ({ id, senderKey, purpose, folderId: senderKey, revision: 7, document: document('Pendiente sin publicar'), text: 'Texto plano propio', subject: 'Asunto pendiente', signatureMode: 'selected', signatureId: 'firma' });
  const published = { ...card('support-active', 'SUPPORT', 'SUPPORT_TICKET_RECEIVED'), document: document('Versión publicada anterior'), subject: 'Asunto publicado', revision: 3 };
  return { templates: [card(APPROVED_WELCOME_TEMPLATE_ID, 'NOREPLY', 'NEWSLETTER_WELCOME'), card('support-active', 'SUPPORT', 'SUPPORT_TICKET_RECEIVED'), card('support-draft', 'SUPPORT', 'SUPPORT_TICKET_RECEIVED'), card('order', 'ORDERS', 'ORDER_SHIPPED'), card('confirmation', 'ORDERS', 'ORDER_CONFIRMATION'), card('reset', 'NOREPLY', 'PASSWORD_RESET'), card('info', 'INFO', 'NEWSLETTER_WELCOME')],
    versions: [{ id: 'history', templateId: 'support-active', snapshot: published }],
    publications: [{ senderKey: 'SUPPORT', purpose: 'SUPPORT_TICKET_RECEIVED:CIRCLE_2', versionId: 'history' }],
    folders: ['NOREPLY', 'ORDERS', 'SUPPORT', 'INFO'].map(key => ({ id: key, senderKey: key, name: 'Círculo 2' })) };
}
describe('production header-only rollout', () => {
  it('uses production identities and only targets published support cards', () => {
    const inventory = fixture(), before = headerHash(inventory), plan = planMailHeaders(inventory);
    expect(plan.entries.map(t => t.id)).toEqual(['support-active', 'order', 'reset']);
    expect(headerHash(inventory)).toBe(before);
  });
  it('updates the draft and published snapshot independently without touching history or activating drafts', async () => {
    const inventory = fixture(), plan = planMailHeaders(inventory);
    const tx = { managedEmailTemplate: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      emailTemplateVersion: { create: jest.fn().mockResolvedValue({ id: 'new-header-version' }) },
      emailPublication: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: jest.fn() } };
    await applyMailHeaders(tx, inventory, plan.stateHash, async (_key, s) => ({ html: JSON.stringify(s.document) }));
    const created = tx.emailTemplateVersion.create.mock.calls[0][0].data;
    expect(created.snapshot.document.blocks[1].text).toBe('Versión publicada anterior');
    expect(created.snapshot.subject).toBe('Asunto publicado');
    expect(created.snapshot.revision).toBe(3);
    expect(created.snapshot.signatureId).toBe('firma');
    expect(created.snapshot.text).toBe('Texto plano propio');
    const draft = tx.managedEmailTemplate.updateMany.mock.calls[0][0].data;
    expect(draft.document.blocks[1].text).toBe('Pendiente sin publicar');
    expect(draft).not.toHaveProperty('text');
    expect(tx.emailPublication.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.emailPublication.updateMany).toHaveBeenCalledWith({ where: { senderKey: 'SUPPORT', purpose: 'SUPPORT_TICKET_RECEIVED:CIRCLE_2', versionId: 'history' }, data: { versionId: 'new-header-version' } });
    expect(inventory.versions[0].snapshot.document.blocks[0].text).toBe('Versión publicada anterior');
  });
  it('fails before writing if production changed after inspection', async () => {
    await expect(applyMailHeaders({} as any, fixture(), 'stale', jest.fn())).rejects.toThrow('MAIL_INVENTORY_CHANGED');
  });
});
