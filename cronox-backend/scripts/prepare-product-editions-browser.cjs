// Prepare a CLI cell with synthetic fixture credentials; never reads real users.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/playwright',process.argv.includes('--editor-save')?'editions-editor-save':'editions-integrated'),step=process.argv[2];
if(!/^[a-z0-9-]+$/.test(step||''))throw Error('Expected a named integration step');
const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json'),'utf8'));
if(fixture.origin!=='http://127.0.0.1:43131'||!fixture.database.startsWith('cronox_editions_ui_'))throw Error('Isolated review only');
const helper=fs.readFileSync(path.join(root,'tests/product-editions/browser-helpers.js'),'utf8'),body=fs.readFileSync(path.join(root,'tests/product-editions',step+'.js'),'utf8');
fs.writeFileSync(path.join(out,step+'.cjs'),'async page => {\nconst f='+JSON.stringify(fixture)+';\n'+helper+'\n'+body+'\n}');
