async page => {
  const origin='http://127.0.0.1:43125';
  if(new URL(page.url()).origin!==origin)throw Error('Disposable loopback server required');
  try {
  const check=(v,m)=>{if(!v)throw Error(m)}, results=[],errors=[],sent=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/auth/change-password'))sent.push(Object.keys(JSON.parse(r.postData()||'{}')).sort())});
  await page.addInitScript(()=>{window.__CRONOX_API_BASE__=location.origin;localStorage.removeItem('cronox_open_auth_on_load')});
  const fixture=kind=>page.request.get(origin+'/__review/fixture/'+kind).then(r=>r.json());
  const database=async(kind,password)=>(await page.request.post(origin+'/__review/check/'+kind,{data:{password}})).json();
  const login=async(email,password)=>page.evaluate(async({email,password})=>{try{return Boolean(await window.CRONOX_API.login({email,password}))}catch{return false}},{email,password});
  const loginUi=async(email,password)=>{
    await page.goto(origin+'/');await page.evaluate(async()=>{await window.CRONOX_API.logout();await window.CRONOX_openAuthModal('login')});
    await page.locator('#authLoginEmail').fill(email);await page.locator('#authLoginPassword').fill(password);
    const reply=page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));await page.locator('#authLoginForm button[type=submit]').click();check((await reply).ok(),'UI login rejected');
    await page.waitForFunction(()=>document.querySelector('#authOverlay').getAttribute('aria-hidden')==='true');
  };
  const openProfile=async kind=>{
    await page.goto(origin+'/__review/session/'+kind);
    const reject=page.getByRole('button',{name:'RECHAZAR',exact:true});if(await reject.isVisible())await reject.click();
    await page.getByRole('button',{name:'Configuración de la cuenta',exact:true}).click();
    await page.locator('#passwordAction').waitFor();
    await page.waitForFunction(()=>!document.querySelector('#passwordAction').disabled);
    await page.locator('#passwordAction').click();
  };
  const save=async(current,next)=>{
    if(current!==null)await page.locator('#currentPassword').fill(current);
    await page.locator('#newPassword').fill(next);await page.locator('#confirmPassword').fill(next);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/change-password'));
    await page.locator('#savePassword').click();return response;
  };
  for(const [width,height,label,kind] of [[1440,1000,'desktop','normal'],[390,844,'mobile','newsletter'],[390,844,'mobile-preregistration','preregister']]){
    await page.setViewportSize({width,height});await openProfile(kind);const data=await fixture(kind);
    check(await page.locator('#currentPasswordLabel').isVisible()===(kind==='normal'),'Current password visibility wrong');
    if(kind==='normal'){
      const count=sent.length;await page.locator('#currentPassword').fill(data.initial);
      for(const invalid of ['short','🔐'.repeat(19)]){
        await page.locator('#newPassword').fill(invalid);await page.locator('#confirmPassword').fill(invalid);await page.locator('#savePassword').click();
        check((await page.locator('#passwordMessage').textContent()).includes('72 bytes'),'Password policy message missing');check(sent.length===count,'Invalid policy reached backend');
      }
      const bad=await save('incorrect-current','CorrectedLocalPassword');check(bad.status()===400,'Incorrect current password accepted');
      await page.waitForFunction(()=>!document.querySelector('#savePassword').disabled);
      check((await page.locator('#passwordMessage').textContent()).includes('actual'),'Missing incorrect-current error');
      check(await page.locator('#passwordForm').isVisible(),'Error hid form');
      check((await database(kind,data.initial)).matches,'Failure changed database');
    }
    const oldCookie=(await page.context().cookies()).find(c=>c.name==='jwt');
    const next=kind==='normal'?'🔐'.repeat(7):'Local-'+crypto.randomUUID();const reply=await save(kind==='normal'?data.initial:null,next);
    check(reply.ok(),'Password save HTTP failure '+reply.status());
    await page.waitForFunction(()=>document.querySelector('#passwordMessage').textContent.includes('correctamente'));
    check((await database(kind,next)).matches,'Saved password missing from database');
    if(kind==='normal')check(!(await database(kind,data.initial)).matches,'Old password still valid in database');
    check(sent.at(-1).join(',')===(kind==='normal'?'currentPassword,newPassword':'newPassword'),'Wrong password payload fields');
    const freshCookie=(await page.context().cookies()).find(c=>c.name==='jwt');check(freshCookie?.httpOnly&&freshCookie.path==='/'&&freshCookie.sameSite==='Lax','Session cookie protections changed');check(freshCookie.value!==oldCookie?.value,'Password change did not rotate session');
    const isolated=await page.context().browser().newContext();try{const stale=await isolated.request.get(origin+'/api/me',{headers:{Authorization:'Bearer '+oldCookie.value}});check(stale.status()===401,'Old session still authorized')}finally{await isolated.close()}
    await page.reload();await page.getByRole('button',{name:'Configuración de la cuenta',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#passwordStatus').textContent.includes('establecida'));
    check(await login(data.email,next),'New password cannot log in');
    if(kind==='normal')check(!(await login(data.email,data.initial)),'Old password can log in');
    await page.screenshot({path:'output/playwright/password-'+label+'.png',fullPage:true});
    await loginUi(data.email,next);
    results.push({kind,viewport:label,changed:true,persisted:true,newLogin:true,correctFields:true});
  }
  await page.goto(origin+'/recuperar-contrasena');const normal=await fixture('normal');
  await page.locator('input[name=email]').fill(normal.email);
  const forgot=page.waitForResponse(r=>r.url().endsWith('/api/auth/forgot-password'));await page.locator('.form button[type=submit]').click();check((await forgot).ok(),'Forgot request failed');
  await page.waitForFunction(()=>document.querySelector('#forgotMessage').textContent.includes('instrucciones'));
  let mail;for(let i=0;i<20;i++){const r=await page.request.get(origin+'/__review/mail/normal');if(r.ok()){mail=await r.json();break}await page.waitForTimeout(100)}check(mail,'Simulated reset email not received');
  await page.goto(mail.url);
  const nextReset='Reset-'+crypto.randomUUID();await page.locator('[name=password]').fill(nextReset);await page.locator('[name=passwordConfirm]').fill(nextReset);
  const reset=page.waitForResponse(r=>r.url().endsWith('/api/auth/reset-password'));await page.locator('.form button[type=submit]').click();check((await reset).ok(),'Valid emailed token rejected');
  await page.waitForFunction(()=>document.querySelector('#resetMessage')?.textContent.includes('correctamente'));
  check((await database('normal',nextReset)).matches,'Reset missing from database');
  results.push({reset:true,validEmailLink:true,persisted:true});
  await page.goto(origin+'/recuperar-contrasena');await page.goto(mail.url);await page.locator('[name=password]').fill('UnusedCandidate');await page.locator('[name=passwordConfirm]').fill('UnusedCandidate');
  const reused=page.waitForResponse(r=>r.url().endsWith('/api/auth/reset-password'));await page.locator('.form button[type=submit]').click();check((await reused).status()===400,'Reused token accepted');
  check((await page.locator('#resetMessage').textContent()).length>0,'Used token error missing');
  check(!await page.locator('.form button[type=submit]').isDisabled(),'Error locked reset button');
  check((await database('normal',nextReset)).matches,'Reused token changed password');
  // Reload the original, still-valid link before submission: the token must survive.
  await page.goto(origin+'/recuperar-contrasena');await page.locator('input[name=email]').fill(normal.email);
  const again=page.waitForResponse(r=>r.url().endsWith('/api/auth/forgot-password'));await page.locator('.form button[type=submit]').click();await again;
  const previous=mail.url;
  for(let i=0;i<20;i++){const r=await page.request.get(origin+'/__review/mail/normal'),current=await r.json();if(current.url!==previous){mail=current;break}await page.waitForTimeout(100)}
  await page.goto(mail.url);await page.reload();
  check(!await page.locator('.form button[type=submit]').isDisabled(),'Reload discarded a valid reset token');
  const afterReload='Reload-'+crypto.randomUUID();await page.locator('[name=password]').fill(afterReload);await page.locator('[name=passwordConfirm]').fill(afterReload);
  const reloaded=page.waitForResponse(r=>r.url().endsWith('/api/auth/reset-password'));await page.locator('.form button[type=submit]').click();check((await reloaded).ok(),'Reloaded valid token rejected');
  check((await database('normal',afterReload)).matches,'Reloaded reset did not persist');
  check(await login(normal.email,afterReload),'Reset password cannot log in');
  // Initial setup of an account created without a password, using the same real reset UI.
  const pending=await fixture('pending');await page.goto(origin+'/recuperar-contrasena');await page.locator('input[name=email]').fill(pending.email);
  const requestPending=page.waitForResponse(r=>r.url().endsWith('/api/auth/forgot-password'));await page.locator('.form button[type=submit]').click();await requestPending;
  let pendingMail;for(let i=0;i<20;i++){const r=await page.request.get(origin+'/__review/mail/pending');if(r.ok()){pendingMail=await r.json();break}await page.waitForTimeout(100)}check(pendingMail,'Pending setup email missing');
  await page.goto(pendingMail.url);const initial='Initial-'+crypto.randomUUID();await page.locator('[name=password]').fill(initial);await page.locator('[name=passwordConfirm]').fill(initial);
  const setup=page.waitForResponse(r=>r.url().endsWith('/api/auth/reset-password'));await page.locator('.form button[type=submit]').click();check((await setup).ok(),'Initial setup rejected');
  check((await database('pending',initial)).matches,'Initial setup did not persist');
  check(await login(pending.email,initial),'Initial setup password cannot log in');
  check((await database('pending',initial)).state==='ACTIVE','Pending account did not activate');
  await loginUi(pending.email,initial);
  results.push({reloadPreserved:true,initialSetupPersisted:true,initialSetupLogin:true});
  await page.setViewportSize({width:1440,height:1000});
  const expired=await (await page.request.get(origin+'/__review/expired/normal')).json();await page.goto(expired.url);
  await page.locator('[name=password]').fill('NotPersisted');await page.locator('[name=passwordConfirm]').fill('NotPersisted');
  const expiredReply=page.waitForResponse(r=>r.url().endsWith('/api/auth/reset-password'));await page.locator('.form button[type=submit]').click();check((await expiredReply).status()===400,'Expired token accepted');
  await page.waitForFunction(()=>document.querySelector('#resetMessage').textContent.includes('caducado'));
  check((await page.locator('#resetMessage').textContent()).includes('Solicita uno nuevo'),'Expired token guidance missing');check(!await page.locator('.form button[type=submit]').isDisabled(),'Expired error locked button');
  check((await database('normal',afterReload)).matches,'Expired token changed password');
  await page.screenshot({path:'output/playwright/password-expired-desktop.png',fullPage:true});
  await page.evaluate(()=>{window.__PASSWORD_REVIEW_DOCUMENT__=true;location.hash='token='+crypto.randomUUID()});
  await page.waitForFunction(()=>!window.__PASSWORD_REVIEW_DOCUMENT__);
  check(!await page.locator('.form button[type=submit]').isDisabled(),'Opening another fragment link failed to initialize its form');
  results.push({expiredRejected:true,actionableError:true,retryEnabled:true,sessionRotated:true,oldSessionRejected:true});
  check(errors.length===0,errors.join(';'));
  return {results,errors};
  } finally {
    // Keep CLI output and browser snapshots free of bearer reset tokens.
    await page.evaluate(()=>history.replaceState(null,'',location.pathname));
  }
}
