// Read one public original and use the actual compiled upload processor.
// Local image QA only: never upload or update a gallery record.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../cronox-backend/node_modules/sharp');
const { ImageProcessorService } = require('../../cronox-backend/dist/images/image-processor.service');
const out = path.resolve(__dirname, '../../output/performance-20261103');
async function main() {
  const cache = path.join(out, 'cache');
  const metadata = fs.readdirSync(cache).filter(f => f.endsWith('.json')).find(f => JSON.parse(fs.readFileSync(path.join(cache, f))).url === 'https://cronox.es/api/gallery');
  const item = JSON.parse(fs.readFileSync(path.join(cache, metadata.slice(0, -5)))).carouselItems[0];
  const response = await fetch(item.imageSrc);
  if (!response.ok) throw Error(`Public original: ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  const images = await new ImageProcessorService().createVariants(source, ['galleryPreview', 'galleryGrid', 'galleryLarge']);
  const results = [];
  for (const image of images) {
    fs.writeFileSync(path.join(out, `gallery-${image.role}.webp`), image.buffer);
    // 297 CSS pixels at DPR 2: same final display scale for visual comparison.
    await sharp(image.buffer).resize({ width: 594 }).png().toFile(path.join(out, `gallery-${image.role}-comparison.png`));
    results.push({ role: image.role, width: image.width, height: image.height, bytes: image.fileSize });
  }
  fs.writeFileSync(path.join(out, 'gallery-preview.json'), JSON.stringify({ original: item.imageSrc, originalBytes: source.length, results }, null, 2));
  console.log(results);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
