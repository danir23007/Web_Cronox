async page => {
  const phase=page.url().endsWith('#after')?'after':'before', browser=page.context().browser(), contexts=[], results=[], errors=[];
  const origin='http://localhost:3000', out='output/playwright/gallery-spacing';
  const items=[1,2,3].map((n)=>({key:'carousel-'+n,position:n,imageSrc:'/assets/products/camiseta_washed_'+(n===2?'negra':'gris')+(n===3?'_2':'')+'.png',alt:'Foto local '+n,description:'Fotografía de revisión local '+n,products:Array.from({length:n===2?3:1},(_,i)=>({id:i+1,name:i?'Camiseta washed negra':'Camiseta washed gris',slug:i?'camiseta-washed-negra':'camiseta-washed-gris',price:3500,currency:'EUR',available:true,imageUrl:'/assets/products/camiseta_washed_'+(i?'negra':'gris')+'.png'}))}));
  const check=(v,msg)=>{if(!v)throw Error(msg);};
  try {
    for(const mobile of [false,true]) {
      const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});contexts.push(c);
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
      await p.addInitScript(()=>{window.__CRONOX_API_BASE__=location.origin;sessionStorage.setItem('cronox_newsletter_seen','1');document.cookie='cronox_cookie_consent='+encodeURIComponent(JSON.stringify({necessary:true,preferences:false,analytics:false,marketing:false,consentVersion:'2',timestamp:new Date().toISOString()}))+'; path=/';});
      await c.route('**/*',async r=>{
        const u=new URL(r.request().url());
        if(u.origin!==origin)return r.abort();
        if(phase==='before'&&u.pathname==='/assets/gallery.css') {
          const response=await r.fetch();
          return r.fulfill({response,body:(await response.text()).replace(/(\.gallery-lightbox--carousel \.gallery-lightbox__info\s*\{\s*padding-top:) 20px;/,'$1 clamp(70px, 9vh, 108px);')});
        }
        if(u.pathname==='/api/gallery')return r.fulfill({json:{mode:'CAROUSEL',carouselItems:items,slots:[]}});
        if(u.pathname==='/api/me')return r.fulfill({status:401,json:{code:'AUTH_REQUIRED'}});
        if(u.pathname.startsWith('/api/'))return r.fulfill({json:{items:[],itemsCount:0,subtotalCents:0}});
        return r.continue();
      });
      await p.goto(origin+'/gallery.html');
      await p.locator('.gallery-carousel__slide').first().waitFor({state:'visible'});
      await p.locator('.gallery-carousel__slide').first().click();
      const box=p.locator('.gallery-lightbox');
      await box.waitFor({state:'visible'});
      for(let slide=0;slide<4;slide++) {
        await p.locator('.gallery-lightbox.is-image-ready').waitFor({state:'visible'});
        const m=await box.evaluate(el=>{
          const rect=s=>el.querySelector(s).getBoundingClientRect(), info=el.querySelector('.gallery-lightbox__info');
          const image=rect('.gallery-lightbox__image'), product=rect('.gallery-lightbox__product');
          return {image:{width:image.width,height:image.height,top:image.top,bottom:image.bottom},productTop:product.top,gap:product.top-(innerWidth<=767?image.bottom:image.top),padding:getComputedStyle(info).paddingTop,products:el.querySelectorAll('.gallery-lightbox__product').length,href:el.querySelector('.gallery-lightbox__product').getAttribute('href')};
        });
        check(m.image.width>200&&m.image.height>200,'Photo missing');
        check(m.href==='/producto/camiseta-washed-gris','Product link changed');
        if(phase==='after'&&!mobile)check(Math.abs(m.gap-20)<1,'Desktop top gap: '+m.gap);
        if(phase==='before'&&!mobile)check(Math.abs(m.gap-90)<1,'Baseline top gap: '+m.gap);
        if(mobile)check(m.gap>=29&&m.gap<=32,'Mobile separation: '+m.gap);
        results.push({phase,mobile,slide,...m});
        if(slide<2){await p.screenshot({path:out+'/'+phase+'-'+(mobile?'mobile':'desktop')+'-'+(m.products===1?'one':'multiple')+'.png'});}
        await p.locator('.gallery-lightbox__arrow--next').click();
        await p.waitForTimeout(220);
      }
      await p.keyboard.press('Escape');
      check(await box.isHidden(),'Close failed');
      await p.evaluate(items=>window.CRONOX_GALLERY.render(items,document.querySelector('#galleryGrid')),items);
      await p.locator('.gallery__tile--trigger').first().click();
      await p.locator('.gallery-lightbox.is-image-ready').waitFor({state:'visible'});
      const mosaicPadding=await p.locator('.gallery-lightbox__info').evaluate(e=>getComputedStyle(e).paddingTop);
      check(mosaicPadding===(mobile?'30px':'90px'),'Other gallery changed: '+mosaicPadding);
      results.push({phase,mobile,mosaicPadding});
    }
    check(errors.length===0,'JavaScript errors: '+errors.join(';'));
    return {phase,scope:'Real storefront on localhost with locally mocked gallery data/assets; all API requests intercepted, no writes',results,errors};
  }finally{for(const c of contexts)await c.close();}
}
