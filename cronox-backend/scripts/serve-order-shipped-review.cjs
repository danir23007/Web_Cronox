const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../output/playwright/order-shipped');
for(let circle=1;circle<=5;circle++) for(const kind of ['send','admin']) {
 const name=`circle-${circle}-${kind}`;
 let html=fs.readFileSync(path.join(root,`${name}.html`),'utf8');
 if(kind==='send') html=html.replaceAll('https://example.test/vertical.png','/vertical.png').replaceAll('https://example.test/horizontal.png','/horizontal.png');
 fs.writeFileSync(path.join(root,`${name}-review.html`),html);
}
const cases=[];
for(let circle=1;circle<=5;circle++) for(const kind of ['send','admin']) for(const width of [320,390,640]) cases.push({circle,kind,width});
fs.writeFileSync(path.join(root,'checks.html'),`<!doctype html><meta charset="utf-8"><title>Comprobación Pedido enviado I–V</title><style>body{font:15px Arial;background:#eee;margin:20px}section{margin:20px 0}iframe{height:1100px;border:0}pre{white-space:pre-wrap}a{color:#125}</style><h1>Pedido enviado I–V</h1><p>Preview y envío a 320, 390 y 640 px. Solo la copia visual del envío sustituye las URLs ficticias por los PNG locales. HTML y MIME originales disponibles en <a href="index.html">el índice</a>.</p><pre id="results">Comprobando…</pre>${cases.map(({circle,kind,width})=>`<section><h2>Círculo ${circle} · ${kind} · ${width}px</h2><iframe title="Círculo ${circle} ${kind} ${width}px" data-kind="${kind}" data-circle="${circle}" width="${width}" src="circle-${circle}-${kind}-review.html"></iframe></section>`).join('')}<script>
window.addEventListener('load',()=>{
 const rows=[...document.querySelectorAll('iframe')].map(f=>{
  const d=f.contentDocument,w=f.contentWindow,actions=d.querySelector('.order-shipped-actions'),a=[...actions.querySelectorAll('a')],r=a.map(x=>x.getBoundingClientRect());
  const image=[...d.querySelectorAll('.order-product-frame img')];
  const bounds=actions.getBoundingClientRect();
  const sameRow=r.length===2&&Math.abs(r[0].top-r[1].top)<1&&Math.abs(r[0].height-r[1].height)<1&&r[0].height>=44;
  const fits=d.documentElement.scrollWidth<=Number(f.width)&&bounds.right<=Number(f.width);
  const clickable=a.every(x=>{const b=x.getBoundingClientRect();x.scrollIntoView();const t=x.getBoundingClientRect();return [[t.left+1,t.top+1],[t.right-1,t.bottom-1]].every(([x,y])=>d.elementFromPoint(x,y)?.closest('a')!==null);});
  w.scrollTo(0,0);
  const proportions=f.dataset.kind!=='send'||image.every(x=>Math.abs((x.width/x.height)-(x.naturalWidth/x.naturalHeight))<.01&&x.width<=70&&x.height<=70);
  return {circle:f.dataset.circle,kind:f.dataset.kind,width:f.width,sameRow,fits,clickable,proportions};
 });
 const good=rows.filter(r=>r.sameRow&&r.fits&&r.clickable&&r.proportions).length;
 document.getElementById('results').textContent=good+'/'+rows.length+' comprobaciones correctas\\n'+JSON.stringify(rows,null,2);
});</script>`);
http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);const file=path.resolve(root,'.'+(name==='/'?'/checks.html':name));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}}).listen(4367,'127.0.0.1',()=>console.log('http://localhost:4367/checks.html'));
