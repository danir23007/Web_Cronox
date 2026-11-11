'use strict';
// Disposable loopback clone. Real Nest controllers, guards, services and SQL;
// only external Stripe, email and object storage are replaced at their boundary.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto'),{Client}=require('pg');
const restockSelection=process.argv.includes('--restock-selection');
const favoritePrices=process.argv.includes('--favorite-prices');
const restockReview=process.argv.includes('--restock')||restockSelection;
const pointCostsReview=process.argv.includes('--point-costs');
const realCostsFile=process.argv.find(a=>a.startsWith('--real-point-costs='))?.slice('--real-point-costs='.length);
const backend=path.resolve(__dirname,'..'),root=path.resolve(backend,'..'),out=path.join(root,'output/playwright',favoritePrices?'favorite-prices':pointCostsReview?'point-costs':restockSelection?'restock-selection':restockReview?'restock-flow':process.argv.includes('--editor-save')?'editions-editor-save':'editions-integrated');
const port=favoritePrices?43134:realCostsFile?43133:pointCostsReview?43132:43131,origin='http://127.0.0.1:'+port,name='cronox_editions_ui_'+randomUUID().replaceAll('-','');
async function main(){
  const env=require('./start-local.cjs').loadLocalEnvironment(),source=new URL(env.DATABASE_URL);source.search='';
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(source.hostname));
  const control=new Client({connectionString:source.href});let created=false,db,app;
  fs.mkdirSync(out,{recursive:true});
  try{
    await control.connect();assert.ok(['127.0.0.1','::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    const dump=path.join(out,'source-local.dump'),bin='C:/Program Files/PostgreSQL/17/bin';
    const run=(tool,args,url)=>{const r=spawnSync(path.join(bin,tool+'.exe'),args,{windowsHide:true,encoding:'utf8',env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))}});assert.equal(r.status,0,tool+' failed');};
    run('pg_dump',['--format=custom','--no-owner','--no-acl',...(realCostsFile?['--schema-only']:[]),'--file',dump],source);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
    const target=new URL(source);target.pathname='/'+name;run('pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',name,dump],target);
    Object.assign(process.env,env,{DATABASE_URL:target.href,DIRECT_URL:target.href,USER_NUMBERING_DATABASE_URL:target.href,FRONTEND_URL:origin,API_PUBLIC_URL:origin,CORS_ORIGINS:origin,PORT:String(port),EMAIL_ENABLED:'false',BACKGROUND_JOBS_ENABLED:'false',CRONOX_ROUTE_SMOKE_MODE:'true',CRONOX_LOCAL_CHECKOUT_TEST:'false',CHECKOUT_RESERVATION_WORKER_ENABLED:'false',STRIPE_WEBHOOK_WORKER_ENABLED:'false',MAILBOX_SEND_ENABLED:'false',MAILBOX_WORKER_ENABLED:'false',NEWSLETTER_EMAIL_WORKER_ENABLED:'false',STRIPE_SECRET_KEY:'sk_test_integrated_fixture_not_real',STRIPE_PUBLISHABLE_KEY:'pk_test_integrated_fixture_not_real',STRIPE_WEBHOOK_SECRET:'whsec_integrated_fixture_not_real',JWT_ACCESS_SECRET:'integrated-only-access-secret-73f4290d',JWT_REFRESH_SECRET:'integrated-only-refresh-secret-19342ad8',RATE_LIMIT_MAX:'10000',RATE_LIMIT_TTL_MS:'1000'});
    if(restockReview)Object.assign(process.env,{CRONOX_ROUTE_SMOKE_MODE:'false',WAITLIST_EMAIL_WORKER_ENABLED:'true'});
    require('ts-node').register({project:path.join(backend,'tsconfig.json'),transpileOnly:true});require('reflect-metadata');
    const {PrismaService}=require('../src/prisma/prisma.service');db=new PrismaService();await db.$connect();
    assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name,name);
    if(realCostsFile)await db.$executeRawUnsafe('INSERT INTO "UserNumberingState" (id,"nextId",revision,ready) VALUES (1,1,0,true)');
    const password='EdicionesPrueba1!',hash=await require('bcrypt').hash(password,10),users={};
    for(const [key,role] of [['admin','SUPERADMIN'],['buyer','USER'],['stale','USER'],['reserved','USER'],['raceA','USER'],['raceB','USER'],['limited','ADMIN']])users[key]=await db.user.create({data:{email:key.toLowerCase()+'-'+name+'@example.test',password:hash,firstName:'Prueba',lastName:'Lotes',role}});
    if(realCostsFile)await require('./import-point-costs-review.cjs')({db,file:realCostsFile,actorId:users.admin.id,database:name});
    const assetDir=path.join(out,'assets');fs.mkdirSync(assetDir,{recursive:true});
    const sharp=require('sharp');
    for(const [file,color] of [['first.png','#34495e'],['second.png','#b03a2e']]){
      const image=restockSelection&&fs.existsSync(path.join(out,'ashen-shell.png'))?sharp(path.join(out,'ashen-shell.png')):restockReview?sharp(path.join(root,'cronox-front/assets/products',file==='first.png'?'camiseta_washed_gris.png':'camiseta_washed_negra.png')):sharp({create:{width:320,height:400,channels:3,background:color}});
      await image.resize(320,400,{fit:'contain',background:'#fff'}).png().toFile(path.join(assetDir,file));
    }
    const product=await db.product.create({data:{name:restockSelection?'ASHEN SHELL':'PRUEBA LOTES INTEGRADA',slug:'prueba-lotes-integrada-'+Date.now(),price:restockSelection?11000:9000,displayOrder:-999,description:'Composición primera tirada: algodón de prueba.',collection:'prueba-local',imageUrl:origin+'/__review/assets/first.png',images:{create:{url:origin+'/__review/assets/first.png',alt:'Imagen de prueba de la primera tirada',isActive:true,isPrimary:true}},privateCost:{create:{unitCostCents:2500}},variants:{create:(restockSelection?['XS','S','M','L','XL','XXL']:['M','L']).map(size=>({size,sku:name+'-'+size,stockQty:0}))}}});
    if(process.argv.includes('--editor-save')) {
      // Known historical transport belongs to this synthetic closed sale. It
      // must never be added again by the revised editor's inclusive unit cost.
      await db.$transaction(async tx=>{
        const lot=await tx.inventoryLot.findFirstOrThrow({where:{productId:product.id}}),variant=await tx.productVariant.findFirstOrThrow({where:{productId:product.id,size:'M'}}),sliceId=randomUUID(),date=new Date('2026-10-01T00:00:00Z');
        const costs=[{lotId:lot.id,sliceId,quantity:1,productionCents:2500,freightCents:75,otherCents:25,quality:'CONFIRMED'}];
        const order=await tx.order.create({data:{userId:users.buyer.id,customerEmail:users.buyer.email,status:'PAID',source:'IN_PERSON_ADMIN',provider:'manual',paymentMethod:'CASH',purchasedAt:date,paidAt:date,subtotal:'90',taxRate:'0.21',taxAmount:'15.62',total:'90',items:{create:{productId:product.id,variantId:variant.id,title:'Venta histórica sintética',quantity:1,unitPrice:'90',lineTotal:'90',financialSnapshot:{create:{productName:product.name,unitCostCents:null,lotCosts:costs}}}}}});
        await tx.inventoryLotSlice.create({data:{id:sliceId,lotId:lot.id,variantId:variant.id,received:1,available:0,productionCents:2500,freightCents:75,otherCents:25}});
        await tx.inventoryLotAllocation.create({data:{id:randomUUID(),sliceId,sourceKey:'order:'+order.id,quantity:1,state:'SOLD',productionCents:2500,freightCents:75,otherCents:25,costQuality:'CONFIRMED'}});
        await tx.inventoryLot.update({where:{id:lot.id},data:{receivedAt:date,costQuality:'CONFIRMED',freightTotalCents:75,otherTotalCents:25}});
        await tx.inventoryLotAudit.create({data:{id:randomUUID(),lotId:lot.id,actorId:users.admin.id,reason:'Recepción histórica sintética',after:{receivedAt:'2026-10-01',lines:[{variantId:variant.id,quantity:1,productionCents:2500}],freightTotalCents:75,otherTotalCents:25}}});
      });
      await db.$executeRawUnsafe('CREATE TABLE "EditorReviewSaveFault" (id INTEGER PRIMARY KEY, "productId" INTEGER NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false)');
      await db.$executeRaw`INSERT INTO "EditorReviewSaveFault" (id,"productId") VALUES (1,${product.id})`;
      await db.$executeRawUnsafe(`CREATE FUNCTION cronox_editor_review_save_fault() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.after ? 'saveRequestKey' AND EXISTS(SELECT 1 FROM "EditorReviewSaveFault" f JOIN "InventoryLot" l ON l."productId"=f."productId" WHERE f.enabled AND l.id=NEW."lotId") THEN RAISE EXCEPTION 'CONTROLLED_EDITOR_SAVE_FAILURE'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER editor_review_save_fault BEFORE INSERT ON "InventoryLotAudit" FOR EACH ROW EXECUTE FUNCTION cronox_editor_review_save_fault()');
    }
    const extraProducts={};
    if(restockReview){
      for(const [kind,sizes] of [['available',[['M',4],['L',3]]],['partial',[['M',0],['L',2]]],['ring',[['US_8',0],['US_9',0]]]]){
        extraProducts[kind]=await db.product.create({data:{name:'PRUEBA AVISOS '+kind,slug:product.slug+'-'+kind,price:9900,displayOrder:-998,description:'Producto aislado para revisar avisos.',sizeSystem:kind==='ring'?'US_RING':'APPAREL',lastUnitsThreshold:3,imageUrl:origin+'/__review/assets/first.png',images:{create:{url:origin+'/__review/assets/first.png',alt:'Imagen de prueba',isActive:true,isPrimary:true}},variants:{create:sizes.map(([size,stockQty])=>({size,stockQty,sku:name+'-'+kind+'-'+size}))}}});
      }
      await db.$executeRawUnsafe('CREATE TABLE "RestockReviewFault" (enabled BOOLEAN NOT NULL DEFAULT false)');
      await db.$executeRawUnsafe('INSERT INTO "RestockReviewFault" VALUES (false)');
      await db.$executeRawUnsafe(`CREATE FUNCTION cronox_restock_review_fault() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM "RestockReviewFault" WHERE enabled) THEN RAISE EXCEPTION 'CONTROLLED_RESTOCK_FAILURE'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe('CREATE TRIGGER restock_review_fault BEFORE INSERT OR UPDATE ON "RestockRequest" FOR EACH ROW EXECUTE FUNCTION cronox_restock_review_fault()');
    }
    const {Test}=require('@nestjs/testing'),{AppModule}=require('../src/app.module'),{EmailService}=require('../src/email/email.service');
    const emails=[];const mail=new Proxy({isEnabled:()=>true},{get:(target,key)=>key==='then'?undefined:key in target?target[key]:async(...args)=>{emails.push({method:String(key),to:args[0]?.to??args[0]});return true;}});
    let restockMailFailure=false;
    if(restockReview){
      mail.isRestockSenderConfigured=()=>true;
      mail.sendRestock=async(to,data)=>{if(restockMailFailure){restockMailFailure=false;throw new (require('../src/email/restock-delivery.error').RestockDeliveryError)('RETRY');}emails.push({method:'sendRestock',to,data});};
    }
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(EmailService).useValue(mail).compile();
    app=module.createNestApplication({logger:['error','warn'],bodyParser:false});app.setGlobalPrefix('api');
    const express=require('express');app.use('/api/webhooks/stripe',express.raw({type:'application/json'}));app.use('/api/payments/webhook',express.raw({type:'application/json'}));app.use(express.json({limit:'100kb'}));app.use(express.urlencoded({extended:true}));app.use(require('cookie-parser')());
    app.use((req,res,next)=>{const token=req.cookies?.cronox_csrf_token||randomBytes(32).toString('base64url');req.csrfToken=token;if(!req.cookies?.cronox_csrf_token)res.cookie('cronox_csrf_token',token,{sameSite:'lax',path:'/'});next();});
    app.useGlobalPipes(require('../src/common/customer-validation').createAppValidationPipe(true));
    const {StripeService}=require('../src/payments/stripe.service'),stripe=app.get(StripeService),sdk=stripe.stripe,intents=new Map();
    stripe.stripe={accounts:{retrieve:async()=>({id:'acct_integrated_fixture'})},webhooks:sdk.webhooks,paymentIntents:{
      create:async args=>{const id='pi_fixture_'+randomUUID().replaceAll('-','');const pi={...args,id,object:'payment_intent',client_secret:id+'_secret_fixture',status:'requires_payment_method',amount_received:0,payment_method_types:['card'],livemode:false};intents.set(id,pi);return structuredClone(pi);},
      retrieve:async id=>{assert.ok(intents.has(id),'Unknown simulated payment');return structuredClone(intents.get(id));},
      update:async(id,data)=>{Object.assign(intents.get(id),data);return structuredClone(intents.get(id));},
      cancel:async id=>{intents.get(id).status='canceled';return structuredClone(intents.get(id));}
    },charges:{list:async()=>({data:[]})}};
    stripe.isBankTransferAvailable=async()=>false;
    const storage=app.get(require('../src/admin/products/admin-products.controller').AdminProductsController).storageService;
    storage.supabaseUrl=origin;storage.serviceRoleKey='fixture-only';
    storage.publicUrl=(_bucket,key)=>origin+'/__review/uploads/'+key;
    storage.uploadObject=async(_bucket,key,buffer)=>{const file=path.resolve(out,'uploads',key);assert.ok(file.startsWith(path.resolve(out,'uploads')+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,buffer);return true;};
    const realFetch=global.fetch;global.fetch=(url,options)=>{const parsed=new URL(typeof url==='string'?url:url.url??url.href);if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('External network blocked in integrated review: '+parsed.hostname);return realFetch(url,options);};
    const state=async()=>({product:await db.product.findUnique({where:{id:product.id},include:{variants:true,images:true,categories:true}}),lots:await db.inventoryLot.findMany({where:{productId:product.id},orderBy:{number:'asc'},include:{slices:{include:{allocations:true}},history:{orderBy:{createdAt:'desc'}}}}),orders:await db.order.findMany({where:{items:{some:{productId:product.id}}},include:{items:{include:{financialSnapshot:true}}},orderBy:{id:'asc'}}),snapshots:await db.checkoutSnapshot.findMany({where:{items:{some:{productId:product.id}}},include:{items:{include:{financialSnapshot:true}},stockReservations:true},orderBy:{createdAt:'asc'}}),points:await db.pointSale.findMany({where:{point:{name:{startsWith:'INTEGRACIÓN LOTES'}}}}),emails:emails.map(e=>({method:e.method}))});
    let stop;const stopped=new Promise(resolve=>stop=resolve);
    const pointCosts=pointCostsReview ? await require('./review-point-costs-fixtures.cjs')({db,app,users,root,out,origin}) : undefined;
    const favoritePriceFixture=favoritePrices?await require('./review-favorite-prices-fixtures.cjs')({db,app,users,root,out,origin}):undefined;
    if(restockSelection){
      const waitlist=app.get(require('../src/waitlist/waitlist.service').WaitlistService);
      for(const v of await db.productVariant.findMany({where:{productId:product.id,size:{in:['XS','M']}}}))await waitlist.join(users.buyer.id,v.id);
    }
    if(restockReview){
      app.use('/__review/restock',async(req,res)=>{try{
        const editions=app.get(require('../src/admin/lots/product-editions.service').ProductEditionsService),waitlist=app.get(require('../src/waitlist/waitlist.service').WaitlistService);
        const dto=req.body||{};
        if(restockSelection&&dto.op==='reset-selection'){
          const all=await db.productVariant.findMany({where:{productId:product.id}});
          for(const v of all)await waitlist.cancel(users.buyer.id,v.id);
          for(const v of all.filter(v=>['XS','M'].includes(v.size)))await waitlist.join(users.buyer.id,v.id);
        }
        if(dto.op==='fault')await db.$executeRaw`UPDATE "RestockReviewFault" SET enabled=${Boolean(dto.enabled)}`;
        if(dto.op==='receive'){
          const state=await editions.list(product.id),lot=state.lots.find(l=>l.id===state.product.activeLotId);
          await editions.save(product.id,lot.id,{revision:lot.revision,receivedAt:'2026-11-04',unitCostCents:2500,expectedStocks:lot.profile.variants.map(v=>({size:v.size,available:v.stockQty})),variants:lot.profile.variants.map(v=>({size:v.size,stockQty:v.stockQty+(v.size===dto.size?1:0)}))},users.admin.id,randomUUID());
        }
        if(dto.op==='prepare'){
          const state=await editions.list(product.id),source=state.lots.find(l=>l.id===state.product.activeLotId),copy=await editions.duplicate(product.id,source.id,source.revision,randomUUID(),users.admin.id),lot=copy.lots.find(l=>l.id===copy.id);
          await editions.save(product.id,lot.id,{revision:lot.revision,receivedAt:'2026-11-04',unitCostCents:3000,expectedStocks:lot.profile.variants.map(v=>({size:v.size,available:0})),variants:lot.profile.variants.map(v=>({size:v.size,stockQty:v.size==='M'?2:0}))},users.admin.id,randomUUID());
        }
        if(dto.op==='activate'){
          const state=await editions.list(product.id),lot=state.lots.find(l=>l.number===2);await editions.activate(product.id,lot.id,lot.revision,users.admin.id);
        }
        if(dto.op==='tick'){
          restockMailFailure=Boolean(dto.fail);
          if(dto.due)await db.restockRequest.updateMany({where:{variant:{productId:product.id},status:'QUEUED'},data:{readyAt:new Date(Date.now()-1000)}});
          await waitlist.tick();
        }
        res.json({requests:await db.restockRequest.findMany({where:{variant:{productId:{in:[product.id,...Object.values(extraProducts).map(p=>p.id)]}}},include:{variant:true}}),emails:emails.filter(e=>e.method==='sendRestock')});
      }catch(e){res.status(500).json({error:e.message});}});
    }
    app.use('/__review/assets',express.static(assetDir));app.use('/__review/uploads',express.static(path.join(out,'uploads')));
    app.use('/__review/state',async(_req,res)=>{try{res.json(await state());}catch(e){res.status(500).json({error:e.message});}});
    if(process.argv.includes('--editor-save'))app.use('/__review/save-fault',async(req,res)=>{if(typeof req.body?.enabled!=='boolean')return res.sendStatus(400);await db.$executeRaw`UPDATE "EditorReviewSaveFault" SET enabled=${req.body.enabled} WHERE id=1`;res.json({enabled:req.body.enabled});});
    app.use('/__review/stripe',async(req,res)=>{try{
      const id=req.body?.id||req.query.id,pi=intents.get(String(id).split('_secret_')[0]);assert.ok(pi,'Missing simulated intent');
      if(req.path==='/confirm'||req.path==='/refund'){
        const refund=req.path==='/refund';pi.status=refund?'succeeded':'succeeded';pi.amount_received=pi.amount;
        const object=refund?{id:'ch_'+pi.id,object:'charge',payment_intent:pi.id,amount:pi.amount,amount_refunded:pi.amount,refunded:true,currency:pi.currency}:pi;
        const event={id:(refund?'evt_refund_':'evt_success_')+pi.id,object:'event',type:refund?'charge.refunded':'payment_intent.succeeded',created:Math.floor(Date.now()/1000),livemode:false,data:{object}};
        const payload=JSON.stringify(event),signature=sdk.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
        const response=await fetch(origin+'/api/webhooks/stripe',{method:'POST',headers:{'content-type':'application/json','stripe-signature':signature},body:payload});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
        await app.get(require('../src/payments/stripe-webhook-recovery.service').StripeWebhookRecoveryService).processEffects();
      }
      res.json({paymentIntent:structuredClone(pi)});
    }catch(e){res.status(500).json({error:e.message});}});
    app.use('/__review/stop',async(_req,res)=>{fs.writeFileSync(path.join(out,'final-state.json'),JSON.stringify(await state(),null,2));res.json({stopped:true});stop();});
    const {cleanPageForPath}=require('../src/common/routing/public-pages');
    app.use((req,res,next)=>{if(req.method!=='GET')return next();const file=cleanPageForPath(req.path)||(req.path.endsWith('.html')?path.basename(req.path):null);if(file&&fs.existsSync(path.join(root,'cronox-front',file))){let html=fs.readFileSync(path.join(root,'cronox-front',file),'utf8').replace('<html ',`<html data-cronox-api-base="${origin}" `);return res.type('html').set('Cache-Control','no-store').send(html);}next();});
    app.use(express.static(path.join(root,'cronox-front/public')));app.use(express.static(path.join(root,'cronox-front')));
    await app.listen(port,'127.0.0.1');
    const fixture={origin,database:name,productId:product.id,slug:product.slug,extraProducts,pointCosts,favoritePriceFixture,users:Object.fromEntries(Object.entries(users).map(([key,user])=>[key,{id:user.id,email:user.email}])),password,image2:path.join(assetDir,'second.png')};
    fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify(fixture,null,2));console.log(JSON.stringify({ready:true,origin,database:name,productId:product.id,externalPayments:'simulated',email:'in-memory',storage:'local-files'}));
    await stopped;
  }finally{if(app)await app.close();if(db)await db.$disconnect();if(created){assert.match(name,/^cronox_editions_ui_[a-f0-9]{32}$/);await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);fs.writeFileSync(path.join(out,'cleanup.json'),JSON.stringify({database:name,removed:true,sourceUnchanged:true}));}await control.end();}
}
main().catch(e=>{console.error(String(e.stack||e.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
