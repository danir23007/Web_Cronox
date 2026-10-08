// Loopback QA only. No production connection, mail or background workers.
'use strict';
const http = require('node:http'), crypto = require('node:crypto');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');
const env = loadLocalEnvironment(), url = new URL(env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || env.EMAIL_ENABLED !== 'false' || env.BACKGROUND_JOBS_ENABLED !== 'false') throw Error('Protected local environment required');
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const origin = 'http://localhost:3000', tag = 'presence-qa-' + crypto.randomUUID(), users = [], hashes = new Set();
const password = crypto.randomUUID();
const dailyProofs = new Set();
async function state(email, pass) {
  const jar = new Map();
  const absorb = r => r.headers.getSetCookie().forEach(c => { const pair = c.split(';')[0], i = pair.indexOf('='); jar.set(pair.slice(0,i), pair.slice(i+1)); });
  const csrf = await fetch(origin+'/api/auth/csrf'); absorb(csrf);
  const response = await fetch(origin+'/api/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json', Origin:origin, Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '), 'x-csrf-token':decodeURIComponent(jar.get('cronox_csrf_token')) }, body:JSON.stringify({email,password:pass}) });
  absorb(response); if(!response.ok) throw Error('Local QA login failed: '+response.status);
  return { cookies:[...jar].map(([name,value])=>({name,value,domain:'localhost',path:'/',httpOnly:!name.startsWith('cronox_csrf'),secure:false,sameSite:'Lax'})), origins:[] };
}
const server = http.createServer(async (req,res)=>{
  try {
    const route = new URL(req.url,'http://127.0.0.1'); let result;
    if(route.pathname==='/admin-state') result=await state(env.LOCAL_ADMIN_EMAIL,env.LOCAL_ADMIN_PASSWORD);
    else if(route.pathname==='/setup') {
      if(!users.length) for(const role of ['USER','USER','ADMIN','SUPERADMIN']) users.push(await db.user.create({data:{email:tag+'-'+users.length+'@example.test',role,accountState:'ACTIVE',password:await bcrypt.hash(password,4)}}));
      result={users:users.map(({id,email,role})=>({id,email,role})),password};
    } else if(route.pathname==='/account-state') { const user=users[Number(route.searchParams.get('index'))]; if(!user) throw Error('Unknown QA account'); result=await state(user.email,password); }
    else if(route.pathname==='/expire' || route.pathname==='/track') {
      const token=route.searchParams.get('token'); const { JwtService }=require('../../cronox-backend/node_modules/@nestjs/jwt');
      const decoded=new JwtService().verify(token,{secret:env.JWT_ACCESS_SECRET,audience:'live-presence',algorithms:['HS256']});
      const hash=crypto.createHash('sha256').update(decoded.vid).digest('hex'); hashes.add(hash);
      const daily=route.searchParams.get('daily');
      if(daily && /^\d{4}-\d{2}-\d{2}\.[a-f0-9]{64}$/.test(daily)) dailyProofs.add(crypto.createHash('sha256').update(daily.slice(11)).digest('hex'));
      if(route.pathname==='/expire') await db.livePresence.updateMany({where:{visitorHash:hash},data:{seenAt:new Date(Date.now()-121000)}});
      result={tracked:true};
    } else if(route.pathname==='/history') {
      result={accounts:await db.dailyVisitor.count({where:{userId:{in:users.slice(0,2).map(u=>u.id)}}})};
    } else if(route.pathname==='/cleanup') {
      await db.livePresence.deleteMany({where:{visitorHash:{in:[...hashes]}}});
      // Daily history is intentionally permanent. Retain local QA facts and
      // links; deleting the fixture accounts anonymizes them through the FK.
      await db.authSession.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});
      await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)},email:{startsWith:tag}}});users.length=0;hashes.clear();dailyProofs.clear();result={cleaned:true};
    } else {res.writeHead(404); return res.end();}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
  } catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(43131,'127.0.0.1',()=>console.log('Local presence QA helper on loopback:43131'));
