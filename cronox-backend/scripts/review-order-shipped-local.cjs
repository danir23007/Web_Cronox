// Local drafts only. Publications and immutable snapshots are never rewritten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./start-local.cjs').loadLocalEnvironment();
assert(['localhost','127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname));
assert.equal(env.EMAIL_ENABLED, 'false');
Object.assign(process.env, env);
const db = new (require('@prisma/client').PrismaClient)();
const { prepareOrderShippedDocument } = require('../dist/email/managed/order-shipped-design');
const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
const { EmailService } = require('../dist/email/email.service');
const { mailPreviewData } = require('../dist/email/managed/welcome-design');
const { containedOrderImage } = require('../dist/email/managed/order-product-image');
const out = path.resolve(__dirname, '../../output/playwright/order-shipped');
async function main() {
 fs.mkdirSync(out,{recursive:true});
 const publications = await db.emailPublication.findMany({orderBy:[{senderKey:'asc'},{purpose:'asc'}]});
 const versions = await db.emailTemplateVersion.findMany({orderBy:{id:'asc'}});
 const other = await db.managedEmailTemplate.findMany({where:{NOT:{purpose:'ORDER_SHIPPED'}},orderBy:{id:'asc'}});
 const rows = await db.managedEmailTemplate.findMany({where:{purpose:'ORDER_SHIPPED',archivedAt:null},include:{folder:true},orderBy:{folder:{name:'asc'}}});
 assert.equal(rows.length,5);
 const captured=[];
 const transport={sendMail:async (sender,message)=>{captured.push(message);return {accepted:[message.to],messageId:'memory-only'};}};
 const service=new ManagedMailService(db,transport);
 const email=new EmailService(transport,service);
 const report=[];
 // Two complete garment fixtures with distinct intrinsic aspect ratios. No network.
 const sharp=require('sharp');
 for (const [name,w,h] of [['vertical',300,600],['horizontal',600,300]]) {
   const svg=`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><path d="M ${w*.3},${h*.12} L ${w*.1},${h*.25} L ${w*.18},${h*.42} L ${w*.3},${h*.35} L ${w*.3},${h*.88} L ${w*.7},${h*.88} L ${w*.7},${h*.35} L ${w*.82},${h*.42} L ${w*.9},${h*.25} L ${w*.7},${h*.12} Z" fill="#B1001A"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-size="18">CRONOX</text></svg>`;
   await sharp(Buffer.from(svg)).png().toFile(path.join(out,`${name}.png`));
 }
 for(let i=0;i<rows.length;i++) {
   let row=rows[i]; const circle=i+1;
   const document=prepareOrderShippedDocument(row.document);
   if(process.argv.includes('--apply') && JSON.stringify(document)!==JSON.stringify(row.document)) {
     const rendered=await service.render(row.senderKey,{...row,document});
     row=await db.managedEmailTemplate.update({where:{id:row.id},data:{document,html:rendered.html,text:rendered.text,revision:{increment:1}}});
   }
   const data={...mailPreviewData('ORDER_SHIPPED'),circleLevel:circle,items:[['vertical',300,600],['horizontal',600,300]].map(([name,w,h])=>({name:`Prenda ${name}`,quantity:1,variantName:'M',imageUrl:`https://example.test/${name}.png`,...containedOrderImage(w,h)}))};
   const effective={...row,document};
   const preview=await service.preview(row.senderKey,{...effective,view:'preview'});
   fs.writeFileSync(path.join(out,`circle-${circle}-admin.html`),preview.html);
   // Resolve the actual saved publication, or exercise this draft without publishing it.
   const published=await service.published(row.senderKey,'ORDER_SHIPPED',data);
   const draftRendered=await service.render(row.senderKey,effective,data,true);
   const sender=new EmailService(transport,{recipientCircle:async()=>circle,published:async()=>published || draftRendered});
   await sender.send({type:'ORDER_SHIPPED',to:'simulated@example.test',subject:row.subject,templateData:data});
   const message=captured.at(-1);
   assert(message.html.includes('order-shipped-actions'));
   assert(!message.html.includes('object-fit'));
   assert(message.html.includes('width="35" height="70"'));
   assert(message.html.includes('width="70" height="35"'));
   fs.writeFileSync(path.join(out,`circle-${circle}-send.html`),message.html);
   // MIME from the actual sending payload, in memory only (no SMTP sockets).
   const nodemailer=require('nodemailer');
   const mime=await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail({...message,from:'orders@example.test'});
   fs.writeFileSync(path.join(out,`circle-${circle}.eml`),mime.message);
   report.push({circle,id:row.id,published:Boolean(published),preview:true,simulatedSend:true});
 }
 assert.deepEqual(await db.emailPublication.findMany({orderBy:[{senderKey:'asc'},{purpose:'asc'}]}),publications);
 assert.deepEqual(await db.emailTemplateVersion.findMany({orderBy:{id:'asc'}}),versions);
 assert.deepEqual(await db.managedEmailTemplate.findMany({where:{NOT:{purpose:'ORDER_SHIPPED'}},orderBy:{id:'asc'}}),other);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({rows:report,realEmailsSent:0,publicationsUnchanged:true,versionsUnchanged:true,otherTemplatesUnchanged:true},null,2));
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>CRONOX · Pedido enviado I–V</title><style>body{font:16px Arial;background:#eee}iframe{height:1250px;border:1px solid #aaa}section{display:inline-block;vertical-align:top;margin:12px}</style><h1>Pedido enviado · Revisión local</h1><p>Envío simulado. Cinco círculos, sin SMTP. Las imágenes vertical y horizontal son prendas de prueba.</p>${report.map(r=>`<section><h2>Círculo ${r.circle}</h2><p><a href="circle-${r.circle}-admin.html">Preview del administrador</a> · <a href="circle-${r.circle}-send.html">HTML de envío</a> · <a href="circle-${r.circle}.eml">MIME</a></p><iframe width="390" src="circle-${r.circle}-send.html"></iframe></section>`).join('')}`);
 console.log(JSON.stringify({out,rows:report,realEmailsSent:0,publicationsUnchanged:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
