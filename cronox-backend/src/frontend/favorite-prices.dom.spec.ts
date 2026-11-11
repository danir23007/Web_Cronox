import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read=(file:string)=>readFileSync(resolve(__dirname,'../../../cronox-front',file),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const windows:JSDOM[]=[];
afterEach(()=>windows.splice(0).forEach(d=>d.window.close()));
const products=[{id:3,name:'ASHEN SHELL',price:11000},{id:4,name:'ARMORED COAL',price:6500},{id:5,name:'DECIMAL',price:3495},{id:6,name:'REAL 1.10',price:110},{id:7,name:'REAL 0.65',price:65}].map(p=>({...p,slug:'product-'+p.id,variants:[{id:p.id,size:'M',stockQty:0}],images:[]}));
async function setup(view:'profile'|'favorites'){
 const dom=new JSDOM(read(view+'.html'),{url:'http://localhost/'+view+'.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});windows.push(dom);const w=dom.window as any;
 const response=(data:unknown)=>({ok:true,status:200,headers:new w.Headers({'Content-Type':'application/json'}),json:async()=>data,text:async()=>JSON.stringify(data),clone:()=>response(data)});
 let currentProducts=products.map(p=>({...p}));
 w.fetch=jest.fn(async(url:string)=>response(url.includes('/api/favorites')?currentProducts.map((product,i)=>({id:i+1,productId:product.id,product})):{}));
 w.eval(read('assets/api.js'));w.CRONOX_USER={id:1,role:'USER',firstName:'Test'};w.CRONOX_AUTH_READY=Promise.resolve();
 w.CRONOX_API.getMe=async()=>w.CRONOX_USER;w.CRONOX_API.getMyOrders=async()=>[];
 w.CRONOX_createProductCard=(p:any)=>{const card=w.document.createElement('article');card.dataset.id=String(p.backendId);card.textContent=p.priceLabel;return card;};
 w.CRONOX_PRODUCTS=[{backendId:3,id:'product-3',slug:'product-3',price:90,priceLabel:'90,00 €',variants:[]}]; // Stale catalogue must not override the current favorite response.
 w.eval(read('assets/'+view+'.js'));await tick();await tick();
 if(view==='profile')w.document.querySelector('[data-profile-tab=favorites]').click();
 await tick();await tick();return {w,document:w.document,setPrice:(price:number)=>{currentProducts=currentProducts.map(p=>p.id===3?{...p,price}:p);}};
}
describe('favorite prices through the real API mapper and both views',()=>{
 it.each(['profile','favorites'] as const)('%s keeps cents/euros explicit, including legitimate small amounts',async view=>{
  const {w,document}=await setup(view);
  const mapped=(await w.CRONOX_API.getFavorites())[0].product;
  expect(mapped).toMatchObject({priceCents:11000,price:110});
  const host=document.querySelector(view==='profile'?'#profileFavoritesGrid':'#favorites-grid');
  expect(host.querySelector('[data-id="3"]').textContent.replace(/\s/g,'')).toBe('110,00€');
  expect(host.querySelector('[data-id="4"]').textContent.replace(/\s/g,'')).toBe('65,00€');
  expect(host.querySelector('[data-id="5"]').textContent.replace(/\s/g,'')).toBe('34,95€');
  expect(host.querySelector('[data-id="6"]').textContent.replace(/\s/g,'')).toBe('1,10€');
  expect(host.querySelector('[data-id="7"]').textContent.replace(/\s/g,'')).toBe('0,65€');
 });
 it.each(['profile','favorites'] as const)('%s reloads the current public price without changing favorite IDs',async view=>{
  const {w,document,setPrice}=await setup(view);setPrice(12500);
  if(view==='profile'){
    document.querySelector('[data-profile-tab=orders]').click();document.querySelector('[data-profile-tab=favorites]').click();
  }else w.dispatchEvent(new w.Event('focus'));
  await tick();await tick();
  const host=document.querySelector(view==='profile'?'#profileFavoritesGrid':'#favorites-grid');
  expect(host.querySelector('[data-id="3"]').textContent.replace(/\s/g,'')).toBe('125,00€');
  expect(host.querySelectorAll('article')).toHaveLength(5);
 });
});
