const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/playwright/point-costs');
const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json'),'utf8'));
if(!['http://127.0.0.1:43132','http://127.0.0.1:43133'].includes(fixture.origin)||!fixture.database.startsWith('cronox_editions_ui_'))throw Error('ISOLATED_POINT_REVIEW_ONLY');
fs.writeFileSync(path.join(out,'browser.cjs'),'async page => {\nconst f='+JSON.stringify(fixture)+';\n'+fs.readFileSync(path.join(root,'tests/sale-point-costs/browser.js'),'utf8')+'\n}');
