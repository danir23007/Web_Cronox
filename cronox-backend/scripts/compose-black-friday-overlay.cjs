'use strict';
const sharp = require('sharp');

// Deterministic pixel composition, never generative editing, cropping or resize.
// Only the panel's fill has alpha. Text stays opaque, and values are literal 00.
function counterPanel(width, height) {
  const panel = { width: Math.round(width * .74), height: Math.round(height * .265) };
  const x = Math.round((width - panel.width) / 2), y = height - panel.height - Math.round(height * .05);
  const digitSize = width * .054, labelSize = width * .022;
  const center = i => x + panel.width * (.14 + i * .24);
  const units = ['DÍAS', 'HORAS', 'MINUTOS', 'SEGUNDOS'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${x}" y="${y}" width="${panel.width}" height="${panel.height}" rx="${width * .006}" fill="#000000" fill-opacity="0.72"/>
    <g fill="#ffffff" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">
    ${units.map((unit, i) => `<text x="${center(i)}" y="${y + panel.height * .59}" font-size="${digitSize}" font-weight="700">00</text><text x="${center(i)}" y="${y + panel.height * .86}" font-size="${labelSize}" letter-spacing="${width * .001}">${unit}</text>`).join('')}
    ${[0, 1, 2].map(i => `<text x="${(center(i) + center(i + 1)) / 2}" y="${y + panel.height * .56}" font-size="${digitSize * .7}" font-weight="700">:</text>`).join('')}
    </g></svg>`;
  return { svg, bounds: { x, y, ...panel } };
}
async function composeBlackFridayOverlay(original) {
  const metadata = await sharp(original).metadata();
  const { width, height } = metadata;
  if (!width || !height || width > 4096 || height > 4096 || width / height < 2.5 || width / height > 3.5)
    throw Error('REVIEW_CAMPAIGN_IMAGE_DIMENSIONS');
  const panel = counterPanel(width, height);
  return { buffer: await sharp(original).composite([{ input: Buffer.from(panel.svg) }]).png().toBuffer(),
    width, height, ...panel };
}
module.exports = { counterPanel, composeBlackFridayOverlay };
