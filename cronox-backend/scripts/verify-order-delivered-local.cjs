// Reads existing five-circle designs only. No SMTP, database writes or browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const env=require('./start-local.cjs').loadLocalEnvironment();
assert(['localhost','127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname));
assert.equal(env.EMAIL_ENABLED,'false');Object.assign(process.env,env);
const db=new(require('@prisma/client').PrismaClient)();
const {ManagedMailService}=require('../dist/email/managed/managed-mail.service');
const {mapDeliveredOrderItems}=require('../dist/email/order-delivered-email.mapper');
const {JSDOM}=require('jsdom');
const out=path.resolve(__dirname,'../../output/playwright/order-delivered');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const report=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const rows=await tx.managedEmailTemplate.findMany({where:{purpose:'ORDER_DELIVERED',archivedAt:null},include:{folder:true},orderBy:{folder:{name:'asc'}}});
  assert.equal(rows.length,5);
  const service=new ManagedMailService(tx,{sendMail:()=>{throw Error('NO_SEND_ALLOWED');}});
  const items=mapDeliveredOrderItems([
    {title:'Prenda vertical',quantity:2,variant:{size:'M'},product:{images:[{url:'https://example.test/vertical.png',width:600,height:1200}]}},
    {title:'Prenda horizontal',quantity:1,variant:{size:'L'},product:{images:[{url:'https://example.test/horizontal.png',width:1200,height:600}]}},
    {title:'Prenda sin imagen',quantity:3,product:{images:[]}},
  ]);
  const cases=[];
  for(const row of rows){
   const versions=await tx.emailTemplateVersion.findMany({where:{templateId:row.id}});
   const publications=await tx.emailPublication.findMany({where:{version:{templateId:row.id}}});
   for(const [index,design] of [row,...versions.map(v=>v.snapshot)].entries()){
    const before=JSON.stringify(design);
    const rendered=await service.render('ORDERS',design,{orderId:'SIMULADO-42',statusLabel:'Pedido entregado',items});
    const d=new JSDOM(rendered.html).window.document,block=d.querySelector('.order-delivered-items');
    assert(block,'Delivery items missing in '+row.folder.name);
    assert.equal(block.querySelectorAll('img').length,2);
    assert(block.textContent.includes('Cantidad: 3'));
    assert(rendered.html.includes('width="35" height="70"'));
    assert(rendered.html.includes('width="70" height="35"'));
    assert(!rendered.html.includes('object-fit'));
    assert.equal(JSON.stringify(design),before);
    fs.writeFileSync(path.join(out,`${row.folder.name.replaceAll(' ','-')}-${index}.html`),rendered.html);
   }
   cases.push({circle:row.folder.name,templateId:row.id,versionsChecked:versions.length,published:publications.length>0});
  }
  return {cases,readOnlyTransaction:true,realEmailsSent:0,snapshotsUnchanged:true};
 },{timeout:30000});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
