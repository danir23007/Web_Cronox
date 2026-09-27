const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateSnapshot,alias,digest}=require('./local-order-snapshot.cjs');
const fixture=()=>({version:1,tables:{Order:[{id:1,customerEmail:'order-1@snapshot.invalid',providerRef:alias('pi_fixture')}],OrderItem:[],OrderItemFinancial:[],StripeWebhookEvent:[],StockMovement:[]}});
test('stable aliases preserve order/payment joins but never live identifiers',()=>{
 assert.equal(alias('pi_fixture'),alias('pi_fixture'));assert.match(alias('pi_fixture'),/^local_snapshot_[a-f0-9]{64}$/);assert.equal(alias(null),null);
});
test('rejects customer contacts, addresses, credentials, private catalogue tables and live identifiers',()=>{
 for(const field of ['shippingAddr','billingAddr','internalNote','userId','trackingNumber']){const s=fixture();s.tables.Order[0][field]='private';assert.throws(()=>validateSnapshot(s));}
 for(const patch of [{customerEmail:'real@example.test'},{providerRef:'pi_live'},{promoCodeCode:'REAL_CODE'}]){const s=fixture();Object.assign(s.tables.Order[0],patch);assert.throws(()=>validateSnapshot(s));}
 const s=fixture();s.tables.ProductCost=[];assert.throws(()=>validateSnapshot(s));
});
test('accepts absent historical snapshots without substituting current product costs',()=>{
 const s=fixture();validateSnapshot(s);assert.deepEqual(s.tables.OrderItemFinancial,[]);
});
test('conflict hashes ignore key order but detect monetary edits',()=>{
 assert.equal(digest({id:1,total:'12.34'}),digest({total:'12.34',id:1}));
 assert.notEqual(digest({id:1,total:'12.34'}),digest({id:1,total:'12.35'}));
});
