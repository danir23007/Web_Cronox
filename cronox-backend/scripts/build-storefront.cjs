// Keep readable sources and minify only measured homepage resources.
// Called by the existing release build; no runtime loader or deferred UI code.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { transform } = require('esbuild');
const root = path.resolve(__dirname, '../../cronox-front');
async function main() {
  const htmlPath = path.join(root, 'index.html');
  let html = await fs.readFile(htmlPath, 'utf8');
  for (const file of ['app.js', 'products.js', 'gallery.js', 'store.css']) {
    const source = await fs.readFile(path.join(root, 'assets', file), 'utf8');
    const extension = path.extname(file);
    const result = await transform(source, { loader: extension === '.css' ? 'css' : 'js', minify: true, target: extension === '.css' ? ['chrome90', 'safari15'] : 'es2020', legalComments: 'inline' });
    const output = file.replace(extension, '.min' + extension);
    const version = createHash('sha256').update(result.code).digest('hex').slice(0, 12);
    await fs.writeFile(path.join(root, 'assets', output), result.code);
    const name = file.slice(0, -extension.length);
    html = html.replace(new RegExp(`assets/${name}(?:\\.min)?\\${extension}\\?v=[a-z0-9]+`, 'g'), `assets/${output}?v=${version}`);
    console.log(`${file}: ${Buffer.byteLength(source)} -> ${Buffer.byteLength(result.code)} bytes`);
  }
  await fs.writeFile(htmlPath, html);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
