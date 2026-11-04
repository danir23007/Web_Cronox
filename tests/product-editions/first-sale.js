const buyer=await session('buyer');
await addFromProduct(buyer);await checkout(buyer);await buyer.screenshot({path:'output/playwright/editions-integrated/first-checkout.png'});await pay(buyer);
const saved=await state();check(saved.orders.length===1,'Old order missing');
const order=saved.orders[0],item=order.items[0],parts=item.financialSnapshot.lotCosts;
check(item.unitPrice==='90' || Number(item.unitPrice)===90,'Old paid price mismatch');
check(parts.reduce((n,p)=>n+p.quantity*(p.productionCents+p.freightCents+p.otherCents),0)===2500,'Old known cost mismatch');
check(parts.every(p=>p.quality==='CONFIRMED'),'Old cost incorrectly unknown');
check(saved.product.variants.find(v=>v.size==='M').stockQty===0,'First edition not exhausted');
return {passed:true,orderId:order.id,paid:order.total,lot:parts[0].lotId,costCents:2500};
