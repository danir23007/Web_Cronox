// Local read-only HTML checks. No recipients, SMTP, browser or screenshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const env=require('./start-local.cjs').loadLocalEnvironment();
assert(['localhost','127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname));assert.equal(env.EMAIL_ENABLED,'false');Object.assign(process.env,env);
const db=new(require('@prisma/client').PrismaClient)();
const {ManagedMailService}=require('../dist/email/managed/managed-mail.service');
const {JSDOM}=require('jsdom');
const out=path.resolve(__dirname,'../../output/playwright/order-returned');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const report=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const columns=await tx.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='OrderTrackingEvent' AND column_name='returnReason'`);
  assert.equal(columns.length,1);
  const templates=await tx.managedEmailTemplate.findMany({where:{purpose:'ORDER_RETURNED',archivedAt:null},include:{folder:true},orderBy:{folder:{name:'asc'}}});assert.equal(templates.length,5);
  const service=new ManagedMailService(tx,{sendMail:()=>{throw Error('NO_SEND_ALLOWED');}});
  const cases=[];
  for(const template of templates){
   const versions=await tx.emailTemplateVersion.findMany({where:{templateId:template.id}});
   for(const [version,design] of [template,...versions.map(v=>v.snapshot)].entries())for(const reason of ['No retirado en plazo',null,'Devuelto al remitente','SR123ABC','']){
    const source=JSON.stringify(design);
    const result=await service.render('ORDERS',design,{orderId:'42',trackingNumber:'PQ123456789ES',trackingUrl:'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=PQ123456789ES',statusLabel:'Devuelto al remitente',returnReason:reason},true);
    const d=new JSDOM(result.html).window.document;
    assert.equal(result.subject,'CRONOX · Correos ha devuelto tu paquete del pedido #42');
    assert.equal(d.querySelector('h1,h2').textContent,'Correos ha devuelto tu paquete');
    assert.equal(d.body.textContent.includes('Motivo indicado por Correos:'),reason==='No retirado en plazo');
    assert.equal(d.querySelector('a[href="mailto:support@cronox.es"]').textContent,'Contactar con CRONOX');
    assert(d.querySelector('a[href*="tracking-number=PQ123456789ES"]'));
    assert.equal(JSON.stringify(design),source);
    fs.writeFileSync(path.join(out,`${template.folder.name.replaceAll(' ','-')}-${version}-${reason==='No retirado en plazo'?'reason':'no-reason'}.html`),result.html);
   }
   const preview=await service.preview('ORDERS',{...template,view:'preview'});assert(preview.html.includes('order-returned-content'));
   assert.equal(preview.subject,'CRONOX · Correos ha devuelto tu paquete del pedido #CRX-1042');
   const pubs=await tx.emailPublication.count({where:{version:{templateId:template.id}}});
   cases.push({circle:template.folder.name,templateId:template.id,versionsChecked:versions.length,published:pubs>0});
  }
  return {cases,readOnlyTransaction:true,scenariosPerDesign:5,realEmailsSent:0,snapshotsUnchanged:true};
 },{timeout:30000});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
