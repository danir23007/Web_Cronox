import sharp from 'sharp';
import { OrderProductImageController } from './order-product-image.controller';

describe('public order-only image resource', () => {
  const originalFetch=global.fetch,originalStorage=process.env.SUPABASE_URL;
  beforeEach(()=>{process.env.SUPABASE_URL='https://catalogue.example.test'});
  afterEach(()=>{global.fetch=originalFetch;if(originalStorage===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalStorage});
  it('serves and caches an email PNG from the registered catalogue image, without credentials or redirects',async()=>{
    const url='https://catalogue.example.test/storage/v1/object/public/product-images/tee.png';
    const source=await sharp({create:{width:200,height:400,channels:3,background:'red'}}).png().toBuffer();
    const fetch=jest.fn().mockResolvedValue(new Response(new Uint8Array(source)));global.fetch=fetch;
    const db:any={productImage:{findFirst:jest.fn().mockResolvedValue({url})}},controller=new OrderProductImageController(db);
    const response:any={set:jest.fn().mockReturnThis(),send:jest.fn()};
    await controller.image(12,response);await controller.image(12,response);
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]).toMatchObject({redirect:'error'});
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    const metadata=await sharp(response.send.mock.calls[0][0]).metadata();expect([metadata.width,metadata.height,metadata.format]).toEqual([140,140,'png']);
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({'Content-Type':'image/png'}));
  });
  it('does not fetch unregistered or non-catalogue URLs',async()=>{
    const fetch=jest.fn();global.fetch=fetch;
    for(const image of[null,{url:'http://127.0.0.1/secret'},{url:'https://catalogue.example.test/private.png'}]){
      const controller=new OrderProductImageController({productImage:{findFirst:async()=>image}} as any);
      await expect(controller.image(12,{} as any)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
