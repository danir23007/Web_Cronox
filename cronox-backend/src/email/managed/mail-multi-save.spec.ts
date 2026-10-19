import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderKey } from '../email.types';
import { MailTransportFactory } from '../mail-transport.factory';
import { MailMultiSaveDto } from './mail.dto';
import { ManagedMailService } from './managed-mail.service';
import { draftScope } from './mail-draft-scope';

const row = (circle: number) => ({ id: `t${circle}`, senderKey: 'ORDERS', folderId: `f${circle}`,
  importKey: `ORDERS:${circle}:ORDER_CONFIRMATION`, familyId: null, purpose: 'ORDER_CONFIRMATION',
  name: `Confirmación ${circle}`, subject: `Asunto ${circle}`, preheader: `Previo ${circle}`,
  document: { blocks: [{ type: 'text', text: `Contenido ${circle} {{message}}` }] },
  html: `<p>HTML distinto ${circle}</p>`, text: `Texto distinto ${circle}`, textOverride: null,
  signatureMode: 'none', signatureId: null, visualClassification: 'DIFFERENT', revision: circle,
  archivedAt: null, folder: { name: `Círculo ${circle}`, position: circle - 1 } });
function fixture() {
  const rows = new Map([1, 2, 3, 4, 5].map(n => [n, row(n)]));
  const db: any = {
    $transaction: jest.fn(async (run: any) => run(db)), $queryRaw: jest.fn(),
    managedEmailTemplate: {
      findFirst: jest.fn(({ where }: any) => [...rows.values()].find(r => r.id === where.id && r.senderKey === where.senderKey)),
      findMany: jest.fn(({ where, select }: any) => select ? [...rows.values()] : [...rows.values()].filter(r => where.id.in.includes(r.id))),
      updateMany: jest.fn(({ where, data }: any) => {
        const r = [...rows.values()].find(r => r.id === where.id);
        if (!r || r.revision !== where.revision) return { count: 0 };
        Object.assign(r, data, { revision: r.revision + 1 }); return { count: 1 };
      }),
    }, auditLog: { create: jest.fn() },
  };
  const service = new ManagedMailService(db as PrismaService, {} as MailTransportFactory);
  const source = rows.get(3)!;
  const input = (extra: any = {}): MailMultiSaveDto => ({ ...source, signatureMode: 'none',
    visualClassification: 'FOR_ALL', targets: [1, 3, 5].map(n => ({ id: rows.get(n)!.id, revision: rows.get(n)!.revision })), ...extra } as any);
  return { rows, db, service, input };
}
describe('design-scoped multi-circle saving', () => {
  it('uses import identity including the variant suffix, campaign family or explicit unlinked selection', () => {
    expect(draftScope(row(3)).where).toEqual({ familyId: null, importKey: { in: [1, 2, 3, 4, 5].map(n => `ORDERS:${n}:ORDER_CONFIRMATION`) } });
    const approved = { ...row(1), senderKey: 'NOREPLY', purpose: 'NEWSLETTER_WELCOME', importKey: 'NOREPLY:1:NEWSLETTER_WELCOME:approved-20261019' };
    expect(JSON.stringify(draftScope(approved).where)).not.toContain('"NOREPLY:1:NEWSLETTER_WELCOME"');
    expect(draftScope({ ...row(3), familyId: 'family-one' })).toMatchObject({ kind: 'family', where: { familyId: 'family-one' } });
    expect(draftScope({ ...row(3), importKey: null }).kind).toBe('explicit');
    expect(draftScope({ ...row(3), importKey: 'unrecognized' }).kind).toBe('single');
  });
  it('discovers design-bound choices in the current mailbox and canonical folders, not by purpose alone', async () => {
    const { service, db } = fixture();
    const result = await service.draftTargets(EmailSenderKey.ORDERS, 't3');
    expect(result.relation).toBe('import');
    expect(result.targets.find(t => t.id === 't3')?.current).toBe(true);
    expect(db.managedEmailTemplate.findMany.mock.calls[0][0].where).toMatchObject({ senderKey: 'ORDERS', purpose: 'ORDER_CONFIRMATION', archivedAt: null,
      OR: [{ id: 't3' }, { AND: [{ importKey: { in: expect.any(Array) } }, { folder: { name: { in: ['Círculo 1', 'Círculo 2', 'Círculo 3', 'Círculo 4', 'Círculo 5'] } } }] }] });
  });
  it.each(['FOR_ALL', 'UNIQUE', 'DIFFERENT'])('persists only %s on selected circles, without invoking the renderer', async visualClassification => {
    const { service, rows, db, input } = fixture();
    const before = JSON.parse(JSON.stringify([...rows]));
    const render = jest.spyOn(service, 'render').mockRejectedValue(new Error('Content must not be rendered'));
    const result = await service.saveDrafts(EmailSenderKey.ORDERS, 't3', input({ visualClassification, saveMode: 'classification' }));
    expect(result.mode).toBe('classification');
    for (const n of [1, 3, 5]) expect(rows.get(n)?.visualClassification).toBe(visualClassification);
    for (const n of [2, 4]) expect(rows.get(n)).toEqual(before.find(([key]: any) => key === n)[1]);
    for (const call of db.managedEmailTemplate.updateMany.mock.calls) expect(Object.keys(call[0].data).sort()).toEqual(['revision', 'updatedBy', 'visualClassification']);
    expect(render).not.toHaveBeenCalled();
    expect(result.updated.map(t => t.id).sort()).toEqual(['t1', 't3', 't5']);
  });
  it('still propagates expressly edited content and classification', async () => {
    const { service, rows, input } = fixture();
    const result = await service.saveDrafts(EmailSenderKey.ORDERS, 't3', input({ subject: 'Edición expresa', saveMode: 'content' }));
    expect(result.mode).toBe('content');
    for (const n of [1, 3, 5]) expect(rows.get(n)?.subject).toBe('Edición expresa');
    expect(rows.get(2)?.subject).toBe('Asunto 2');
    expect(rows.get(1)?.name).toBe('Confirmación 1');
  });
  it('preserves per-circle colors on a later content-only save, including old clients that send the unchanged source color', async () => {
    const { service, rows, input } = fixture();
    rows.get(1)!.visualClassification = 'UNIQUE';
    rows.get(3)!.visualClassification = 'FOR_ALL';
    await service.saveDrafts(EmailSenderKey.ORDERS, 't3', input({ subject: 'Solo contenido', visualClassification: 'FOR_ALL' }));
    expect([1, 3, 5].map(n => rows.get(n)!.visualClassification)).toEqual(['UNIQUE', 'FOR_ALL', 'DIFFERENT']);
    expect([1, 3, 5].map(n => rows.get(n)!.subject)).toEqual(['Solo contenido', 'Solo contenido', 'Solo contenido']);
  });
  it.each(['stale', 'foreign', 'duplicate', 'content-mode-mismatch', 'archived', 'same-circle'])('rejects %s before any writes', async problem => {
    const { service, rows, db, input } = fixture();
    const data = input();
    if (problem === 'stale') data.targets[0].revision = 88;
    if (problem === 'foreign') data.targets[0].id = 'other-design';
    if (problem === 'duplicate') data.targets[0].id = 't3';
    if (problem === 'content-mode-mismatch') { data.saveMode = 'classification'; data.subject = 'Changed'; }
    if (problem === 'archived') rows.get(1)!.archivedAt = new Date() as any;
    if (problem === 'same-circle') rows.get(1)!.folderId = 'f3';
    await expect(service.saveDrafts(EmailSenderKey.ORDERS, 't3', data)).rejects.toThrow();
    expect(db.managedEmailTemplate.updateMany).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation for unlinked candidate designs', async () => {
    const { service, rows, input, db } = fixture(); rows.get(3)!.importKey = null as any;
    const data = input();
    await expect(service.saveDrafts(EmailSenderKey.ORDERS, 't3', data)).rejects.toThrow(/explícitamente/);
    expect(db.managedEmailTemplate.updateMany).not.toHaveBeenCalled();
    await expect(service.saveDrafts(EmailSenderKey.ORDERS, 't3', { ...data, explicitSelection: true })).resolves.toMatchObject({ mode: 'classification' });
  });
});
