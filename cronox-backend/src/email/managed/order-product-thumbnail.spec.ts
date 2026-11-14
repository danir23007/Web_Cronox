import sharp from 'sharp';
import { createOrderProductThumbnail, orderProductThumbnail } from './order-product-thumbnail';
import { previewCatalogProduct } from './mail-preview-product';
import { OrderConfirmationEmailMapper } from '../order-confirmation-email.mapper';
import { Decimal } from '@prisma/client/runtime/library';

describe('email-only product margin reduction', () => {
  it.each([[300, 600], [600, 300], [500, 500]])('preserves the whole garment and sleeves within the same frame (%sx%s)', async (width, height) => {
    // Sleeves extend beyond the body on both sides; tiny edge details count.
    const source = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><path d="M ${width*.25},${height*.25} L ${width*.1},${height*.35} L ${width*.2},${height*.45} L ${width*.3},${height*.4} L ${width*.3},${height*.8} L ${width*.7},${height*.8} L ${width*.7},${height*.4} L ${width*.8},${height*.45} L ${width*.9},${height*.35} L ${width*.75},${height*.25} Z" fill="#B1001A"/></svg>`);
    const { buffer, crop } = await createOrderProductThumbnail(source);
    expect(crop.left).toBeLessThan(width*.1); expect(crop.top).toBeLessThan(height*.25);
    expect(crop.left+crop.width).toBeGreaterThan(width*.9); expect(crop.top+crop.height).toBeGreaterThan(height*.8);
    expect(crop.width).toBeGreaterThanOrEqual(width/1.18); expect(crop.height).toBeGreaterThanOrEqual(height/1.18);
    expect(crop.width).toBeLessThan(width); expect(crop.height).toBeLessThan(height);
    const metadata = await sharp(buffer).metadata(); expect([metadata.width,metadata.height,metadata.format]).toEqual([140,140,'png']);
  });
  it('leaves edge-filling photos and non-white backgrounds uncropped', async () => {
    for (const background of ['#B1001A', '#eeeeee']) {
      const original = await sharp({create:{width:300,height:600,channels:3,background}}).png().toBuffer();
      expect((await createOrderProductThumbnail(original)).crop).toEqual({left:0,top:0,width:300,height:600});
    }
  });
  it('retains white sleeves on transparent photos rather than treating them as empty margins', async () => {
    const source=Buffer.from('<svg width="300" height="600"><rect x="10" y="50" width="280" height="450" fill="white"/><rect x="100" y="100" width="100" height="300" fill="red"/></svg>');
    const {crop}=await createOrderProductThumbnail(source);
    expect(crop.left).toBe(0); expect(crop.width).toBe(300);
    expect(crop.top).toBeLessThan(50);expect(crop.top+crop.height).toBeGreaterThan(500);
  });
  it('handles grayscale catalogue originals using the same safety margin', async () => {
    const source=await sharp(Buffer.from('<svg width="300" height="600"><rect width="300" height="600" fill="white"/><rect x="50" y="100" width="200" height="400" fill="#777777"/></svg>')).greyscale().png().toBuffer();
    const {crop}=await createOrderProductThumbnail(source);
    expect(crop.left).toBeLessThan(50);expect(crop.left+crop.width).toBeGreaterThan(250);
    expect(crop.top).toBeLessThan(100);expect(crop.top+crop.height).toBeGreaterThan(500);
  });
  it('uses the identical catalogue image endpoint in Preview and automatic order data only', async () => {
    const before = process.env.SUPABASE_URL; process.env.SUPABASE_URL='https://catalogue.example.test';
    try {
      const image={id:12,url:'https://catalogue.example.test/storage/v1/object/public/product-images/red.png',width:300,height:600};
      const product:any={name:'SCARRED TEE red',id:2,slug:'scarred-red',price:4000,images:[image],variants:[{id:21,size:'M',stockQty:4,price:4000}],inventoryLots:[]};
      const preview=await previewCatalogProduct({product:{findMany:async()=>[product]}} as any,2,21,'ORDER_CONFIRMATION');
      const data=new OrderConfirmationEmailMapper().map({id:1042,shippingCost:0,subtotal:new Decimal(40),total:new Decimal(40),taxAmount:new Decimal(7),items:[{title:product.name,product,variant:{size:'M'},quantity:1,unitPrice:new Decimal(40),lineTotal:new Decimal(40)}]} as any);
      expect(preview.data).toMatchObject({items:[orderProductThumbnail(image)!]});
      expect(data.items[0]).toMatchObject(orderProductThumbnail(image)!);
      const other=await previewCatalogProduct({product:{findMany:async()=>[product]}} as any,2,21,'RESTOCK');
      expect(other.data).toMatchObject({imageUrl:image.url});
      expect(orderProductThumbnail({...image,url:'https://elsewhere.test/a.png'})).toBeNull();
      expect(orderProductThumbnail({...image,url:'https://catalogue.example.test/private.png'})).toBeNull();
      expect(orderProductThumbnail()).toBeNull();
    } finally { if(before===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=before; }
  });
});
