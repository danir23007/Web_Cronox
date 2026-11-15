import { mapDeliveredOrderItems } from './order-delivered-email.mapper';

export const deliveredLineFixtures: any[] = [
  {id:1,title:'Camiseta comprada roja',quantity:2,variant:{size:'M'},financialSnapshot:{imageUrl:'https://example.test/purchased.png'},product:{name:'Nombre cambiado',imageUrl:'https://example.test/product.png',images:[{url:'https://example.test/current.png',width:900,height:900},{url:'https://example.test/purchased.png',width:600,height:1200}]}},
  {id:2,title:'Prenda horizontal',quantity:1,variant:{size:'L'},financialSnapshot:null,product:{name:'Prenda horizontal',images:[{url:'https://example.test/landscape.png',width:1200,height:600}]}},
  {id:3,title:'Sin foto (S)',quantity:3,variant:null,financialSnapshot:null,product:{name:'Sin foto',images:[],imageUrl:null}},
];

describe('real delivered order lines',()=>{
  it('keeps purchased line identity, size and quantity; prefers its saved photo to the current product photo',()=>{
    expect(mapDeliveredOrderItems(deliveredLineFixtures)).toEqual([
      {name:'Camiseta comprada roja',quantity:2,variantName:'M',imageUrl:'https://example.test/purchased.png',imageWidth:35,imageHeight:70},
      {name:'Prenda horizontal',quantity:1,variantName:'L',imageUrl:'https://example.test/landscape.png',imageWidth:70,imageHeight:35},
      {name:'Sin foto (S)',quantity:3,variantName:'S'},
    ]);
  });
  it('falls back to the product URL, rejects malformed/unsafe URLs and omits missing photos',()=>{
    const line={...deliveredLineFixtures[2],financialSnapshot:{imageUrl:'javascript:invalid'},product:{images:[{url:'invalid'}],imageUrl:'https://example.test/fallback.png'}};
    expect(mapDeliveredOrderItems([line])[0]).toMatchObject({imageUrl:'https://example.test/fallback.png'});
    expect(mapDeliveredOrderItems([{...line,product:null}])[0]).not.toHaveProperty('imageUrl');
    expect(mapDeliveredOrderItems([])).toEqual([]);
  });
});
