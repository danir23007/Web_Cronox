import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createOrderProductThumbnail, orderProductThumbnail } from './order-product-thumbnail';
import { mapDeliveredOrderItems } from '../order-delivered-email.mapper';
import { previewCatalogProduct } from './mail-preview-product';
import { ManagedMailService } from './managed-mail.service';

async function darkBounds(buffer: Buffer) {
  const {data,info}=await sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,top=info.height,right=-1,bottom=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*info.channels;
    if(data[i]<120&&data[i+1]<120&&data[i+2]<120){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  return {left,top,right,bottom,width:right-left+1,height:bottom-top+1};
}
describe('delivered-only 15% garment framing',()=>{
 it.each([[600,900],[900,600],[600,600]])('increases the full black garment uniformly in the unchanged frame (%sx%s)',async(width,height)=>{
   const source=await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><path d="M ${width*.3},${height*.2} L ${width*.2},${height*.3} L ${width*.25},${height*.4} L ${width*.35},${height*.35} L ${width*.35},${height*.8} L ${width*.65},${height*.8} L ${width*.65},${height*.35} L ${width*.75},${height*.4} L ${width*.8},${height*.3} L ${width*.7},${height*.2} Z" fill="black"/></svg>`)).png().toBuffer();
   const baseline=await sharp(source).resize(140,140,{fit:'contain',background:'#ffffff'}).png().toBuffer();
   const result=await createOrderProductThumbnail(source,'delivered');
   const before=await darkBounds(baseline),after=await darkBounds(result.buffer);
   // At 140px antialiasing can move each detected black edge by one pixel.
   expect(Math.abs(after.width-before.width*1.15)).toBeLessThanOrEqual(2);
   expect(Math.abs(after.height-before.height*1.15)).toBeLessThanOrEqual(2);
   expect(result.crop.width).toBeGreaterThanOrEqual(Math.ceil(width/1.15));
   expect(result.crop.height).toBeGreaterThanOrEqual(Math.ceil(height/1.15));
   // Verify the geometric aspect independently of raster edge rounding.
   expect(Math.abs((result.crop.width/result.crop.height)/(width/height)-1)).toBeLessThan(.002);
   expect(Math.abs((after.left+after.right)/2-69.5)).toBeLessThan(1.5);
   expect(Math.abs((after.top+after.bottom)/2-69.5)).toBeLessThan(1.5);
   expect(result.crop.left).toBeLessThan(width*.2);expect(result.crop.left+result.crop.width).toBeGreaterThan(width*.8);
   expect(result.crop.top).toBeLessThan(height*.2);expect(result.crop.top+result.crop.height).toBeGreaterThan(height*.8);
   const metadata=await sharp(result.buffer).metadata();expect([metadata.width,metadata.height]).toEqual([140,140]);
 });
 it('limits enlargement rather than cutting sleeves or edge details; leaves uncertain backgrounds intact',async()=>{
   for(const background of ['#777777','#ffffff']){
     const source=await sharp(Buffer.from(`<svg width="300" height="600"><rect width="100%" height="100%" fill="${background}"/><rect x="0" y="50" width="300" height="500" fill="black"/></svg>`)).png().toBuffer();
     expect((await createOrderProductThumbnail(source,'delivered')).crop).toEqual({left:0,top:0,width:300,height:600});
   }
   const transparent=await sharp(Buffer.from('<svg width="300" height="600"><rect x="5" y="70" width="290" height="450" fill="white"/><rect x="100" y="150" width="100" height="250" fill="black"/></svg>')).png().toBuffer();
   const result=await createOrderProductThumbnail(transparent,'delivered');
   expect(result.crop.left).toBeLessThan(5);expect(result.crop.left+result.crop.width).toBeGreaterThan(295);
   expect(result.crop.top).toBeLessThan(70);expect(result.crop.top+result.crop.height).toBeGreaterThan(520);
 });
 it.each([1,2,3,4,5])('uses the delivered framing in circle %s published HTML and admin data with 70px frames',async circle=>{
   const original=process.env.SUPABASE_URL;process.env.SUPABASE_URL='https://catalogue.example.test';
   try{
     const photo={id:12,url:'https://catalogue.example.test/storage/v1/object/public/product-images/black.png',width:600,height:900};
     const product:any={id:2,name:'Camiseta negra',slug:'black',images:[photo],price:4000,variants:[{id:20,size:'M',stockQty:2}],inventoryLots:[]};
     const item=mapDeliveredOrderItems([{title:product.name,quantity:2,variant:{size:'M'},product,financialSnapshot:{imageUrl:photo.url}}] as any)[0];
     expect(item).toMatchObject({imageUrl:'https://cronox.es/api/email/order-product-image/12/delivered.png?v=1',imageWidth:70,imageHeight:70});
     const preview=await previewCatalogProduct({product:{findMany:async()=>[product]}} as any,2,20,'ORDER_DELIVERED');
     if (!('items' in preview.data)) throw Error('Missing catalogue preview items');
     expect(preview.data.items[0]).toMatchObject(orderProductThumbnail(photo,'delivered')!);
     for(const purpose of ['ORDER_SHIPPED','RESTOCK']){
       const other=await previewCatalogProduct({product:{findMany:async()=>[product]}} as any,2,20,purpose);
       if (!('items' in other.data)) throw Error('Missing catalogue preview items');
       expect(other.data.items[0].imageUrl).toBe(photo.url);
     }
     expect(orderProductThumbnail(photo)!.imageUrl).toBe('https://cronox.es/api/email/order-product-image/12.png?v=1');
     const snapshot={senderKey:'ORDERS',purpose:'ORDER_DELIVERED',publicationCircle:circle,subject:'Entregado',preheader:'',signatureMode:'none',document:{blocks:[{type:'html',html:readFileSync(join(__dirname,'../templates/order-delivered.hbs'),'utf8')}]}};
     const before=JSON.stringify(snapshot);
     const service=new ManagedMailService({emailPublication:{findUnique:async()=>({version:{snapshot}})}} as any,{} as any);
     const rendered=await service.published('ORDERS' as any,'ORDER_DELIVERED',{circleLevel:circle,orderId:'42',statusLabel:'Pedido entregado',items:[item]});
     const d=new JSDOM(rendered!.html).window.document,frame=d.querySelector('.order-product-frame')!,image=frame.querySelector('img')!;
     expect(frame.getAttribute('width')).toBe('70');expect(frame.getAttribute('height')).toBe('70');
     expect(image.getAttribute('width')).toBe('70');expect(image.getAttribute('height')).toBe('70');
     expect(image.getAttribute('src')).toContain('/12/delivered.png?v=1');expect(image.parentElement!.getAttribute('align')).toBe('center');
     expect(JSON.stringify(snapshot)).toBe(before);
   }finally{if(original===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=original;}
 });
});
