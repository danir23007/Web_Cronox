'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../..'),out=path.join(root,'output/playwright/favorite-prices');
const f=JSON.parse(fs.readFileSync(path.join(out,'fixture.json'),'utf8'));
if(f.origin!=='http://127.0.0.1:43134'||!/^cronox_editions_ui_[a-f0-9]{32}$/.test(f.database))throw Error('ISOLATED_FAVORITE_REVIEW_REQUIRED');
fs.writeFileSync(path.join(out,'browser.cjs'),'async page=>{const f='+JSON.stringify(f)+',check=(v,m)=>{if(!v)throw Error(m)};\n'+fs.readFileSync(path.join(root,'tests/product-editions/favorite-prices.js'),'utf8')+'\n}');
