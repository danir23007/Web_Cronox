'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {waitForBackend}=require('./wait-for-backend.cjs');
test('waits for listening and readiness, and fails closed for persistent unavailable readiness',async()=>{
 const server=http.createServer((req,res)=>{res.statusCode=req.url==='/api/ready'&&!ready?503:200;res.end('{}');});let ready=false;
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const listening=setTimeout(()=>server.listen(port,'127.0.0.1'),60),available=setTimeout(()=>{ready=true;},140);
 try {await waitForBackend({base:'http://127.0.0.1:'+port,timeout:1500,interval:20});ready=false;
  await assert.rejects(waitForBackend({base:'http://127.0.0.1:'+port,timeout:150,interval:20}),/startup deadline/);
 } finally {clearTimeout(listening);clearTimeout(available);await new Promise(r=>server.close(r));}
});
