import sharp from 'sharp';
import { createCartProductThumbnail, cartProductThumbnail } from './order-product-thumbnail';
import { previewCatalogProduct } from './mail-preview-product';

describe('basket-only centered square photo', () => {
  it.each([[300, 600], [600, 300], [300, 300]])('fills all edges, centers the crop and preserves geometry (%sx%s)', async (width, height) => {
    const side = Math.min(width, height), radius = side / 4;
    const original = await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#138b37"/><rect width="${(width-side)/2}" height="100%" fill="red"/><rect width="100%" height="${(height-side)/2}" fill="red"/><rect x="${(width+side)/2}" width="${width}" height="100%" fill="blue"/><rect y="${(height+side)/2}" width="100%" height="${height}" fill="blue"/><circle cx="${width/2}" cy="${height/2}" r="${radius}" fill="white"/></svg>`)).png().toBuffer();
    const before = Buffer.from(original), result = await createCartProductThumbnail(original);
    expect(original.equals(before)).toBe(true);
    const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([140, 140]);
    for (const [x,y] of [[0,0],[139,0],[0,139],[139,139],[70,0],[0,70],[139,70],[70,139]])
      expect([...data.subarray((y*140+x)*3,(y*140+x)*3+3)].every((value, i) => Math.abs(value-[19,139,55][i]) <= 16)).toBe(true);
    const white = (x: number,y: number) => data[(y*140+x)*3] > 240;
    const horizontal = Array.from({length:140},(_,i)=>i).filter(x=>white(x,70));
    const vertical = Array.from({length:140},(_,i)=>i).filter(y=>white(70,y));
    expect(Math.abs(horizontal.length-vertical.length)).toBeLessThanOrEqual(1);
    expect(Math.abs((horizontal[0]+horizontal.at(-1)!)/2-69.5)).toBeLessThan(1);
    expect(Math.abs((vertical[0]+vertical.at(-1)!)/2-69.5)).toBeLessThan(1);
    expect(horizontal.length).toBeGreaterThanOrEqual(68); expect(horizontal.length).toBeLessThanOrEqual(71);
  });
  it('uses the same public resource in preview and real basket data, including legacy product photos', async () => {
    const product: any = { id: 42, name:'Prenda', currency:'EUR', price:2500, activeLotId:null, images:[], imageUrl:'https://example.test/photo.png', inventoryLots:[], variants:[{id:7,isActive:true,stockQty:2,size:'M',price:2500}] };
    const preview = await previewCatalogProduct({product:{findMany:async()=>[product]}} as any,42,7,'CART_ABANDONED');
    if (!('items' in preview.data)) throw Error('PREVIEW_ITEMS_MISSING');
    expect(preview.data.items![0]).toMatchObject(cartProductThumbnail(product));
    expect(cartProductThumbnail(product)).toEqual({imageUrl:'https://cronox.es/api/email/order-product-image/cart/42.png?v=1',imageWidth:70,imageHeight:70});
  });
});
