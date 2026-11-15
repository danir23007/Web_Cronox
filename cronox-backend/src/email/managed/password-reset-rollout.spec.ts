import { applyPasswordReset, approvedPasswordReset, planPasswordReset } from './password-reset-rollout';
import { headerHash } from './mail-header-rollout';
const fixture = () => {
  const templates = Array.from({ length: 5 }, (_, index) => ({ id: 'reset-'+(index+1), senderKey: 'NOREPLY', purpose: 'PASSWORD_RESET', folderId: 'circle-'+(index+1), revision: 8,
    name: 'Nombre local pendiente '+index, signatureMode: 'selected', signatureId: 'firma-pendiente', document: { blocks: [{ type: 'text', text: 'Borrador anterior' }] } }));
  const snapshot = { ...templates[2], name: 'Nombre publicado', signatureId: 'firma-publicada', revision: 3 };
  return { templates, folders: templates.map((t,i) => ({ id: t.folderId, senderKey: 'NOREPLY', name: 'Círculo '+(i+1) })),
    versions: [{ id: 'old-version', templateId: templates[2].id, snapshot }],
    publications: [{ senderKey: 'NOREPLY', purpose: 'PASSWORD_RESET:CIRCLE_3', versionId: 'old-version' }] };
};
describe('approved password reset rollout', () => {
  it('targets the five existing cards and preserves their identities and classification', () => {
    const state=fixture(), before=headerHash(state), plan=planPasswordReset(state);
    expect(plan.entries.map(e=>e.id)).toEqual(state.templates.map(t=>t.id));
    expect(plan.entries.every(e=>e.draft.document.blocks.length>0)).toBe(true);
    expect(plan.entries[0].draft.name).toBe(state.templates[0].name);
    expect(headerHash(state)).toBe(before);
    expect(()=>approvedPasswordReset({ senderKey:'NOREPLY',purpose:'PASSWORD_SETUP_NEW_ACCOUNT' })).toThrow('PASSWORD_RESET_ONLY');
  });
  it('retains draft-only circles and updates an active version from its own metadata', async () => {
    const state=fixture(),plan=planPasswordReset(state),tx={managedEmailTemplate:{updateMany:jest.fn().mockResolvedValue({count:1})},emailTemplateVersion:{create:jest.fn().mockResolvedValue({id:'new-version'})},emailPublication:{updateMany:jest.fn().mockResolvedValue({count:1})},auditLog:{create:jest.fn()}};
    const result=await applyPasswordReset(tx,state,plan.stateHash,async()=>({html:'Español',text:'Español'}));
    expect(tx.managedEmailTemplate.updateMany).toHaveBeenCalledTimes(5);
    expect(tx.emailPublication.updateMany).toHaveBeenCalledTimes(1);
    const active=tx.emailTemplateVersion.create.mock.calls[0][0].data.snapshot;
    expect(active.name).toBe('Nombre publicado');expect(active.signatureId).toBe('firma-publicada');expect(active.revision).toBe(3);
    expect(active.document).toEqual(plan.entries[2].draft.document);
    expect(result.filter(r=>r.source==='spanish-fallback')).toHaveLength(4);
    expect(state.versions[0].snapshot.document.blocks[0].text).toBe('Borrador anterior');
  });
  it('fails before any update when the inventory changes or circles are missing', async () => {
    await expect(applyPasswordReset({},fixture(),'stale',jest.fn())).rejects.toThrow('MAIL_STATE_CHANGED');
    const state=fixture();state.templates.pop();expect(()=>planPasswordReset(state)).toThrow('FIVE_EXISTING');
  });
});
