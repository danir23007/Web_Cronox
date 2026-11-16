// Existing published circle II–V versions, read-only DB and memory-only delivery.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const env=require('./start-local.cjs').loadLocalEnvironment();
assert(['localhost','127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname));assert.equal(env.EMAIL_ENABLED,'false');Object.assign(process.env,env);
const db=new(require('@prisma/client').PrismaClient)();
const {ManagedMailService}=require('../dist/email/managed/managed-mail.service');
const {EmailService}=require('../dist/email/email.service');
const {circlePromotionData,CIRCLE_PROMOTION_SUBJECT}=require('../dist/email/managed/circle-promotion-design');
const {JSDOM}=require('jsdom');
const out=path.resolve(__dirname,'../../output/playwright/circle-promotion-redesign');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const fixturePath=process.argv[process.argv.indexOf('--snapshots')+1];
 const fixture=process.argv.includes('--snapshots')?JSON.parse(fs.readFileSync(path.resolve(fixturePath),'utf8')):null;
 const fixtureDb=fixture?{
  emailPublication:{findMany:async()=>structuredClone(fixture),findUnique:async({where})=>fixture.find(p=>p.purpose===where.senderKey_purpose.purpose)||null},
  managedEmailTemplate:{findUniqueOrThrow:async({where})=>fixture.find(p=>p.version.templateId===where.id).version.snapshot},
  emailTemplateFolder:{findFirst:async({where})=>{const p=fixture.find(p=>p.version.snapshot.folderId===where.id);return p?{id:where.id,name:'Círculo '+p.version.snapshot.publicationCircle}:null;}},
 }:null;
 const run=fixture?work=>work(fixtureDb):work=>db.$transaction(work,{timeout:30000});
 const report=await run(async tx=>{
  if(!fixture)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const pubs=await tx.emailPublication.findMany({where:{senderKey:'NOREPLY',purpose:{startsWith:'CIRCLE_PROMOTION:CIRCLE_'}},include:{version:true},orderBy:{purpose:'asc'}});
  assert.equal(pubs.length,4,'Expected four existing promotion publications');
  const before=JSON.stringify(pubs),sent=[];
  const transport={sendMail:async(_sender,message)=>{sent.push(message);return {accepted:[message.to],messageId:'memory-only'};}};
  const service=new ManagedMailService(tx,transport),email=new EmailService(transport,service),cases=[];
  for(const pub of pubs){
   const level=Number(pub.purpose.split('_').at(-1));
   const template=await tx.managedEmailTemplate.findUniqueOrThrow({where:{id:pub.version.templateId}});
   const data={...circlePromotionData(level-1,level,'https://example.test'),circleBenefit6:' \t '};
   const published=await service.published('NOREPLY','CIRCLE_PROMOTION',data);
   assert(published);
   const preview=await service.preview('NOREPLY',{...template,view:'preview'});
   for(const html of [published.html,preview.html]){
    const d=new JSDOM(html).window.document;
    const bullets=[...d.querySelectorAll('td,p,li')].filter(n=>!n.querySelector('td,p,li,table')&&/^•/.test(n.textContent.trim()));
    assert.equal(bullets.length,({2:1,3:2,4:3,5:3})[level]);
    for(const el of d.querySelectorAll('[style],[bgcolor]')){
     if(el.tagName==='A')continue;
     if(el.getAttribute('bgcolor'))assert.equal(el.getAttribute('bgcolor'),'#000000');
     if(el.style.backgroundColor)assert.equal(el.style.backgroundColor,'rgb(0, 0, 0)');
    }
    assert.equal(d.body.style.backgroundColor,'rgb(0, 0, 0)');
    assert.equal(d.querySelector('a').textContent,'Ver mi acreditación');
    assert.equal(d.querySelector('a').getAttribute('href'),'https://example.test/cuenta?login=1#accreditation');
    assert.equal((d.body.textContent.match(/Pásate por tu cuenta/g)||[]).length,1);
   }
   await email.send({type:'CIRCLE_PROMOTION',to:'simulated@example.test',subject:CIRCLE_PROMOTION_SUBJECT,templateData:data});
   assert.equal(sent.at(-1).html,published.html);
   fs.writeFileSync(path.join(out,`circle-${level}-send.html`),published.html);
   fs.writeFileSync(path.join(out,`circle-${level}-preview.html`),preview.html);
   cases.push({circle:level,publishedVersion:pub.versionId,benefits:({2:1,3:2,4:3,5:3})[level],preview:true,memoryDelivery:true});
  }
  assert.equal(JSON.stringify(await tx.emailPublication.findMany({where:{senderKey:'NOREPLY',purpose:{startsWith:'CIRCLE_PROMOTION:CIRCLE_'}},include:{version:true},orderBy:{purpose:'asc'}})),before);
  return {cases,readOnlyTransaction:!fixture,productionReadOnlyExport:Boolean(fixture),publicationsUnchanged:true,realEmailsSent:0};
 });
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
