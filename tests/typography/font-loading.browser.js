// Run with playwright-cli run-code --filename; against the guarded local server.
async (page) => {
  const results=[];
  await page.context().clearCookies();
  for(const width of [320,1440]){
    await page.setViewportSize({width,height:900});
    const requests=[];
    const slow=async route=>{requests.push(new URL(route.request().url()).pathname);await new Promise(resolve=>setTimeout(resolve,1500));await route.continue();};
    await page.route('**/*.woff2',slow);
    await page.goto('http://localhost:3000/recuperar-contrasena',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(150);
    const before=await page.evaluate(()=>{
      const el=document.querySelector('h1'),r=el.getBoundingClientRect();
      return {fontStatus:document.fonts.status,text:el.textContent,visible:getComputedStyle(el).visibility,display:getComputedStyle(el).display,x:r.x,y:r.y,width:r.width,height:r.height,bodyWidth:document.body.scrollWidth};
    });
    await page.evaluate(async()=>{await document.fonts.ready;});
    const after=await page.evaluate(()=>{
      const el=document.querySelector('h1'),r=el.getBoundingClientRect();
      return {loaded:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),family:getComputedStyle(el).fontFamily,x:r.x,y:r.y,width:r.width,height:r.height,bodyWidth:document.body.scrollWidth};
    });
    if(before.visible!=='visible'||before.display==='none'||!before.height||!after.loaded.includes('Cormorant Garamond'))throw Error('Invisible text or missing real webfont');
    results.push({width,before,after,requests});
    await page.unroute('**/*.woff2',slow);
  }
  return results;
}
