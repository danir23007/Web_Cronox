'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
async function start(databaseUrl,directory) {
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin='http://127.0.0.1:'+port,backend=path.resolve(__dirname,'..');
 const env={...process.env};for(const key of Object.keys(env))if(/^(MAILBOX_|SMTP_|EMAIL_|SUPABASE_|STRIPE_|JWT_|DATABASE_URL$|DIRECT_URL$|USER_NUMBERING_DATABASE_URL$)/.test(key))env[key]='';
 Object.assign(env,require('../test/test-environment.cjs').withTestEnvironment({}, {force:true}),{NODE_ENV:'development',PORT:String(port),HOST:'127.0.0.1',DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl,USER_NUMBERING_DATABASE_URL:databaseUrl,FRONTEND_URL:origin,API_PUBLIC_URL:origin,CORS_ORIGINS:origin,CRONOX_ENV_FILE:path.join(directory,'absent.env'),BACKGROUND_JOBS_ENABLED:'false',WAITLIST_EMAIL_WORKER_ENABLED:'false',MAILBOX_WORKER_ENABLED:'false',MAILBOX_SEND_ENABLED:'false',CRONOX_LOCAL_DEV:'true'});
 const log=fs.openSync(path.join(directory,'http.log'),'a');
 const child=spawn(process.execPath,['dist/main.js'],{cwd:backend,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
 const stop=async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}};
 try {
  let ready=false;
  for(let i=0;i<600;i++){
   if(child.exitCode!==null)throw Error('Disposable HTTP app failed to boot; see '+path.join(directory,'http.log'));
   try{const response=await fetch(origin+'/api/auth/csrf');if(response.ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error('Disposable HTTP app did not become ready');
  return {origin,stop};
 }catch(error){await stop();throw error;}
}
function browser(origin) {
 const cookies=new Map();
 return async (route,method='GET',body,headers={})=>{
  const csrf=cookies.get('cronox_csrf_token');
  const response=await fetch(origin+route,{method,redirect:'manual',headers:{Accept:'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':decodeURIComponent(csrf)}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const json=await response.json().catch(()=>null);return {status:response.status,json};
 };
}
async function verify(origin,identities,oldAccess) {
 const admin=browser(origin);assert.equal((await admin('/api/auth/csrf')).status,200);
 const login=await admin('/api/auth/login','POST',{email:'fixture-18@example.test',password:'Local-Numbering-Test!23'});assert.equal(login.status,200);assert.equal(login.json.user.id,1);assert.equal(login.json.user.identityUid,identities.admin);
 assert.equal((await admin('/api/me')).json.identityUid,identities.admin);
 const list=await admin('/api/admin/users?pageSize=2');assert.equal(list.status,200);assert.deepEqual(list.json.data.map(u=>u.registrationNumber),[1,2]);
 const second=await admin('/api/admin/users?page=2&pageSize=2');assert.deepEqual(second.json.data.map(u=>u.registrationNumber),[3,4]);
 const current=await admin('/api/admin/users/2','GET',null,{'X-Cronox-User-Identity':identities.second});assert.equal(current.status,200);assert.equal(current.json.user.email,'fixture-10@example.test');
 assert.equal((await admin('/api/admin/users/2','GET',null,{'X-Cronox-User-Identity':identities.deleted})).status,409);
 assert.equal((await admin('/api/admin/users/2')).status,409);
 assert.equal((await admin('/api/admin/notes','POST',{targetType:'user',targetId:'2',content:'Must not be created'},{'X-Cronox-User-Identity':identities.deleted})).status,409);
 const administrators=await admin('/api/admin/mailbox/administrators');assert.equal(administrators.status,200);assert.equal(administrators.json.find(user=>user.id===2).identityUid,identities.second);
 const mailboxInput={name:'Numbering fixture',address:'numbering-mail@example.test',fromName:'CRONOX',username:'numbering-mail@example.test',provider:'hostinger',active:false,sentCopy:'append',imapHost:'imap.hostinger.com',imapPort:993,smtpHost:'smtp.hostinger.com',smtpPort:465,permissions:[{userId:2,identityUid:identities.second,access:'read'}]};
 const configured=await admin('/api/admin/mailbox/boxes','POST',mailboxInput);assert.equal(configured.status,201);
 const box=configured.json.boxes.find(box=>box.address===mailboxInput.address);assert.equal(box.permissions[0].identityUid,identities.second);
 for(const identityUid of [identities.deleted,undefined])assert.equal((await admin('/api/admin/mailbox/boxes/'+box.id,'PATCH',{...mailboxInput,revision:box.revision,permissions:[{userId:2,identityUid,access:'send'}]})).status,409);
 assert.equal((await admin('/api/admin/mailbox/overview')).json.boxes.find(current=>current.id===box.id).permissions[0].access,'read');
 const legacy=browser(origin);assert.equal((await legacy('/api/me','GET',null,{Authorization:'Bearer '+oldAccess})).status,401);
 const guest=browser(origin);await guest('/api/auth/csrf');
 const registered=await guest('/api/auth/register','POST',{firstName:'Local',lastName:'Fixture',email:'http-new@example.test',password:'Local-Numbering-Test!23'});assert.equal(registered.status,201);assert.equal(registered.json.user.id,11);assert.equal(registered.json.user.memberCode,'CRX-000011');
 const changed=await guest('/api/me','PATCH',{name:'Local Profile'});assert.equal(changed.status,200);assert.equal(changed.json.identityUid,registered.json.user.identityUid);
 assert.equal((await guest('/api/me')).json.name,'Local Profile');
 const relogin=browser(origin);await relogin('/api/auth/csrf');assert.equal((await relogin('/api/auth/login','POST',{email:'http-new@example.test',password:'Local-Numbering-Test!23'})).status,200);
 return ['Full Nest HTTP login/profile/register/admin pagination, new registration 11/CRX-000011, stale numeric links and notes rejected, old access token rejected','Real HTTP mailbox grant retains current ADMIN UUID; stale/missing UUID rejected without altering the grant'];
}
module.exports={start,verify};
