'use strict';
// Anonymous public GETs only. Do not print remote HTML or arbitrary health data.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const frontend=path.resolve(__dirname,'../../cronox-front');
const release=encodeURIComponent(process.argv[2]||'manual-review');
const hash=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
(async()=>{
 for(const name of ['admin.html','assets/admin-shell.js','assets/admin-inbox.js','assets/admin-inbox.css','assets/admin-gallery.js','assets/campaign-arrival.js']){
  const response=await fetch('https://cronox.es/'+name+'?release-check='+release);
  const remote=await response.text(),local=fs.readFileSync(path.join(frontend,name),'utf8');
  console.log(JSON.stringify({asset:name,status:response.status,sourceMatches:hash(local)===hash(remote)}));
 }
 const health=await fetch('https://cronox.es/api/health');
 const data=await health.json();
 console.log(JSON.stringify({publicHealthStatus:health.status,ok:data.ok===true}));
})().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
