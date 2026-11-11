'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/playwright/restock-selection');
const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json'),'utf8'));
if(fixture.origin!=='http://127.0.0.1:43131'||!/^cronox_editions_ui_[a-f0-9]{32}$/.test(fixture.database))throw Error('ISOLATED_RESTOCK_REVIEW_REQUIRED');
for(const [test,output]of [['restock-selection.js','browser.cjs'],['restock-selection-mobile.js','mobile.cjs']]){
 const code=fs.readFileSync(path.join(root,'tests/product-editions',test),'utf8');
 fs.writeFileSync(path.join(out,output),'async page=>{const f='+JSON.stringify(fixture)+',check=(v,m)=>{if(!v)throw Error(m)};\n'+code+'\n}');
}
