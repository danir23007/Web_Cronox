'use strict';
// Read-only bounded readiness check; never reruns migrations or deployment.
async function waitForBackend({base='http://127.0.0.1:3000',timeout=60000,interval=1000}={}) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) {
    try {
      const statuses=await Promise.all(['/api/health','/api/ready'].map(async route=>{
        const response=await fetch(base+route,{signal:AbortSignal.timeout(Math.min(3000,Math.max(1,deadline-Date.now())))});
        await response.arrayBuffer(); return response.status;
      }));
      if(statuses.every(status=>status===200))return;
    } catch { /* PM2 may be online before Nest binds its listening socket. */ }
    await new Promise(resolve=>setTimeout(resolve,Math.min(interval,Math.max(0,deadline-Date.now()))));
  }
  throw Error('Backend health/readiness did not become HTTP 200 within the startup deadline.');
}
module.exports={waitForBackend};
if(require.main===module)waitForBackend().then(()=>console.log('BACKEND_HEALTH_AND_READY_OK')).catch(error=>{console.error(error.message);process.exitCode=1;});
