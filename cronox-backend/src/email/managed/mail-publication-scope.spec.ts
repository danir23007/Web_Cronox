import { ManagedMailService } from './managed-mail.service';
import { EmailService } from '../email.service';
import { EmailSenderKey, EmailType } from '../email.types';
import { snapshotMailCircle } from './mail-publication-scope';
import { mailPreviewData } from './welcome-design';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { MailTransportFactory } from '../mail-transport.factory';
import * as quota from '../mail-account-quota';
import * as security from '../../mailbox/mailbox-security';
import { simpleParser } from 'mailparser';

const support = { senderKey:'SUPPORT',purpose:'SUPPORT_TICKET_RECEIVED',subject:'Published circle 4',preheader:'',signatureMode:'none',signatureId:null,
  document:{blocks:[{type:'text',text:'Published {{supportCaseId}} {{customerEmail}}'}]} };
describe('independent circular publication compatibility and recipient lookup',()=>{
  afterEach(()=>jest.restoreAllMocks());
  it('withdraws only this circle even if the draft purpose changed after publication',async()=>{
    const template={id:'same-card',senderKey:'NOREPLY',folderId:'f3',purpose:'NEWSLETTER_WELCOME',revision:1};
    const refs=[{purpose:'PASSWORD_RESET:CIRCLE_1',versionId:'keep-one',version:{snapshot:{publicationCircle:1}}},
      {purpose:'PASSWORD_RESET:CIRCLE_3',versionId:'remove-three',version:{snapshot:{publicationCircle:3}}},
      {purpose:'INITIAL_PASSWORD_SETUP',versionId:'remove-legacy-three',version:{snapshot:{publicationCircle:3}}}];
    const db:any={managedEmailTemplate:{findFirst:jest.fn().mockResolvedValue(template),updateMany:jest.fn().mockResolvedValue({count:1})},emailTemplateFolder:{findFirst:jest.fn().mockResolvedValue({name:'Círculo 3'})},
      emailPublication:{findMany:jest.fn().mockResolvedValue(refs),deleteMany:jest.fn()},auditLog:{create:jest.fn()}};db.$transaction=async run=>run(db);
    await new ManagedMailService(db,{} as any).action(EmailSenderKey.NOREPLY,template.id,{action:'unpublish',confirmed:true,revision:1});
    expect(db.emailPublication.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{senderKey:'NOREPLY',version:{templateId:'same-card'}}}));
    expect(db.emailPublication.deleteMany.mock.calls.map(call=>call[0].where.versionId)).toEqual(['remove-three','remove-legacy-three']);
  });
  it('keeps a global legacy publication confined to the circle in its immutable folder snapshot',async()=>{
    const snapshot={...support,folderId:'original-four'},db:any={emailTemplateFolder:{findFirst:jest.fn().mockResolvedValue({name:'Círculo 4'})},emailPublication:{findUnique:jest.fn(async({where})=>where.senderKey_purpose.purpose==='SUPPORT_TICKET_RECEIVED'?{version:{snapshot}}:null)}};
    const service=new ManagedMailService(db,{} as any),data=mailPreviewData(support.purpose);
    for(const circleLevel of[1,2,3,5])expect(await service.published(EmailSenderKey.SUPPORT,support.purpose,{...data,circleLevel})).toBeNull();
    expect((await service.published(EmailSenderKey.SUPPORT,support.purpose,{...data,circleLevel:4}))?.subject).toBe('Published circle 4');
    expect(db.emailTemplateFolder.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'original-four',senderKey:'SUPPORT'}}));
    expect(snapshot).not.toHaveProperty('publicationCircle');
  });
  it('never guesses a circle for unknown recipients, missing legacy evidence or conflicting metadata',async()=>{
    const db:any={emailPublication:{findUnique:jest.fn().mockResolvedValue({version:{snapshot:support}})}};
    const service=new ManagedMailService(db,{} as any);
    for(const circleLevel of[undefined,null,0,6,'3'])expect(await service.published(EmailSenderKey.SUPPORT,support.purpose,{circleLevel})).toBeNull();
    expect(db.emailPublication.findUnique).not.toHaveBeenCalled();
    // An unscoped old record without a folder/immutable circle is ambiguous.
    db.emailPublication.findUnique.mockImplementation(async({where})=>where.senderKey_purpose.purpose===support.purpose?{version:{snapshot:support}}:null);
    expect(await service.published(EmailSenderKey.SUPPORT,support.purpose,{circleLevel:4})).toBeNull();
    expect(await snapshotMailCircle(db,'ORDERS',{publicationCircle:3,purpose:'ORDER_CONFIRMATION',document:{orderCircle:4}})).toBeNull();
    expect(await snapshotMailCircle(db,'SUPPORT',null)).toBeNull();
  });
  it('resolves authenticated recipients by email for callers/queues without explicit circle and falls back for guests',async()=>{
    const db:any={user:{findFirst:jest.fn(async({where})=>where.email.equals==='lucia@example.test'?{circleLevel:4}:null)},emailPublication:{findUnique:jest.fn(async({where})=>where.senderKey_purpose.purpose.endsWith(':CIRCLE_4')?{version:{snapshot:{...support,publicationCircle:4}}}:null)}};
    const sendMail=jest.fn().mockResolvedValue({messageId:'memory',accepted:['lucia@example.test']}),managed=new ManagedMailService(db,{sendMail} as any),email=new EmailService({sendMail} as any,managed);
    for(const to of['lucia@example.test','guest@example.test'])await email.send({type:EmailType.SUPPORT_TICKET_RECEIVED,to,subject:'First-party fallback',templateData:mailPreviewData(support.purpose)});
    expect(sendMail.mock.calls[0][1].subject).toBe('Published circle 4');expect(sendMail.mock.calls[1][1].subject).toBe('First-party fallback');
    expect(db.user.findFirst).toHaveBeenCalledTimes(2);
  });
  it('keeps the resolved circle/version inside the real deferred MIME queue even after republication',async()=>{
    let job:any,liveSnapshot:any={...support,senderKey:'ORDERS',purpose:'ORDER_CONFIRMATION',publicationCircle:3,subject:'Original circle III',document:structuredDocumentForPurpose('ORDER_CONFIRMATION')};
    const managedDb:any={user:{findFirst:async()=>({circleLevel:3})},emailPublication:{findUnique:async({where})=>where.senderKey_purpose.purpose==='ORDER_CONFIRMATION:CIRCLE_3'?{version:{snapshot:liveSnapshot}}:null}};
    const queueDb:any={emailDelivery:{create:jest.fn(async({data})=>{job={...data,updatedAt:new Date()};return job}),findMany:jest.fn(async()=>[job]),updateMany:jest.fn(),update:jest.fn(async({data})=>Object.assign(job,data))},$queryRaw:jest.fn(async()=>[{id:job.id}])};
    queueDb.$transaction=async run=>run(queueDb);
    const reserve=jest.spyOn(quota,'reserveAccountQuota').mockRejectedValueOnce(new quota.EmailQuotaWaitError(new Date())).mockResolvedValue(undefined);
    jest.spyOn(security,'encrypt').mockImplementation(value=>value);jest.spyOn(security,'decrypt').mockImplementation(value=>value);
    const factory=new MailTransportFactory(queueDb);(factory as any).config.accounts.ORDERS.user='orders@example.test';
    jest.spyOn(factory,'getFrom').mockReturnValue('orders@example.test');
    const smtp=jest.fn().mockResolvedValue({messageId:'memory-only',accepted:['lucia@example.test']});jest.spyOn(factory,'getTransport').mockReturnValue({sendMail:smtp} as any);
    const managed=new ManagedMailService(managedDb,factory),email=new EmailService(factory,managed);
    expect(await email.send({type:EmailType.ORDER_CONFIRMATION,to:'lucia@example.test',subject:'fallback',templateData:mailPreviewData('ORDER_CONFIRMATION')})).toMatchObject({queued:true});
    expect(smtp).not.toHaveBeenCalled();
    liveSnapshot={...liveSnapshot,subject:'Republished later circle III'};
    await factory.tickDeferred();
    expect(reserve).toHaveBeenCalledTimes(2);expect(smtp).toHaveBeenCalledTimes(1);
    const parsed=await simpleParser(smtp.mock.calls[0][0].raw);
    expect(parsed.subject).toBe('Original circle III');expect(parsed.html).toContain('order-circle-3');expect(parsed.html).not.toContain('Republished later');
  });
});
