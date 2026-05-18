#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FAVICON_PATH = path.resolve(__dirname, '..', 'public', 'favicon.png');
const ALPHA_THRESHOLD = 1;
const SAFETY_MARGIN_RATIO = 0.06; // 6% margin per side

function readUInt32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(filePath) {
  const data = fs.readFileSync(filePath);
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature');

  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idatParts = [];

  while (offset < data.length) {
    const length = readUInt32BE(data, offset); offset += 4;
    const type = data.subarray(offset, offset + 4).toString('ascii'); offset += 4;
    const chunk = data.subarray(offset, offset + length); offset += length;
    offset += 4; // skip CRC

    if (type === 'IHDR') {
      width = readUInt32BE(chunk, 0);
      height = readUInt32BE(chunk, 4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'IDAT') {
      idatParts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Only RGBA PNG (bit depth 8, color type 6) is supported. Got bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  if (interlace !== 0) throw new Error('Interlaced PNG not supported');

  const compressed = Buffer.concat(idatParts);
  const raw = zlib.inflateSync(compressed);
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);

  let inPos = 0;
  let outPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    for (let x = 0; x < stride; x++) {
      const curr = raw[inPos++];
      const left = x >= bpp ? out[outPos - bpp] : 0;
      const up = y > 0 ? out[outPos - stride] : 0;
      const upLeft = (y > 0 && x >= bpp) ? out[outPos - stride - bpp] : 0;
      let val;
      if (filter === 0) val = curr;
      else if (filter === 1) val = (curr + left) & 255;
      else if (filter === 2) val = (curr + up) & 255;
      else if (filter === 3) val = (curr + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) val = (curr + paethPredictor(left, up, upLeft)) & 255;
      else throw new Error(`Unsupported filter: ${filter}`);
      out[outPos++] = val;
    }
  }

  return { width, height, rgba: out };
}

function findAlphaBounds(width, height, rgba, threshold = 1) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a >= threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('No visible pixels found in favicon');
  return { minX, minY, maxX, maxY };
}

function sampleNearest(src, sw, sh, dx, dy, dw, dh, dest, destSize) {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / dh) * sh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x / dw) * sw));
      const sIdx = (sy * sw + sx) * 4;
      const dIdx = ((dy + y) * destSize + (dx + x)) * 4;
      dest[dIdx] = src[sIdx];
      dest[dIdx + 1] = src[sIdx + 1];
      dest[dIdx + 2] = src[sIdx + 2];
      dest[dIdx + 3] = src[sIdx + 3];
    }
  }
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba, filePath) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let srcPos = 0, dstPos = 0;
  for (let y = 0; y < height; y++) {
    raw[dstPos++] = 0;
    rgba.copy(raw, dstPos, srcPos, srcPos + stride);
    srcPos += stride;
    dstPos += stride;
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, png);
}

function main() {
  const shouldWrite = process.argv.includes("--write");
  const { width, height, rgba } = decodePngRgba(FAVICON_PATH);
  const size = Math.max(width, height);
  const bounds = findAlphaBounds(width, height, rgba, ALPHA_THRESHOLD);
  const cropW = bounds.maxX - bounds.minX + 1;
  const cropH = bounds.maxY - bounds.minY + 1;

  const cropped = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((bounds.minY + y) * width + bounds.minX) * 4;
    const dstStart = y * cropW * 4;
    rgba.copy(cropped, dstStart, srcStart, srcStart + cropW * 4);
  }

  const margin = Math.max(1, Math.round(size * SAFETY_MARGIN_RATIO));
  const targetContent = size - margin * 2;
  const scale = Math.min(targetContent / cropW, targetContent / cropH);
  const newW = Math.max(1, Math.round(cropW * scale));
  const newH = Math.max(1, Math.round(cropH * scale));

  const canvas = Buffer.alloc(size * size * 4, 0);
  const dx = Math.floor((size - newW) / 2);
  const dy = Math.floor((size - newH) / 2);
  sampleNearest(cropped, cropW, cropH, dx, dy, newW, newH, canvas, size);

  if (shouldWrite) {
    encodePngRgba(size, size, canvas, FAVICON_PATH);
    console.log(`favicon updated: ${FAVICON_PATH}`);
  } else {
    console.log(`dry-run: no se escribió archivo. Ejecuta con --write para sobrescribir ${FAVICON_PATH}`);
  }
  console.log(`size: ${width}x${height} -> ${size}x${size}`);
  console.log(`visible bounds: x=${bounds.minX}-${bounds.maxX}, y=${bounds.minY}-${bounds.maxY}`);
  console.log(`scaled logo: ${newW}x${newH}, margin=${margin}px`);
}

main();
