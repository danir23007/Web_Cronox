import sharp from 'sharp';

/** Only remove near-white/transparent empty margins. Never crop a non-white
 * pixel, never enlarge by more than 18%, and keep the full original otherwise. */
export async function createOrderProductThumbnail(source: Buffer) {
  const image = await sharp(source, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info: { width, height, channels } } = image;
  let borderPixels = 0, transparentPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
    borderPixels++; if (data[(y * width + x) * channels + 3] <= 2) transparentPixels++;
  }
  const transparentBackground = transparentPixels / borderPixels >= .995;
  const white = (x: number, y: number) => {
    const offset = (y * width + x) * channels;
    if (transparentBackground) return data[offset + 3] <= 2;
    if (data[offset + 3] <= 2) return true;
    return data[offset] >= 247 && data[offset + 1] >= 247 && data[offset + 2] >= 247;
  };
  let left = width, top = height, right = -1, bottom = -1, border = 0, emptyBorder = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const empty = white(x, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) { border++; if (empty) emptyBorder++; }
    if (!empty) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  let crop = { left: 0, top: 0, width, height };
  if (emptyBorder / border >= .995 && right >= left && bottom >= top) {
    const safety = Math.max(2, Math.ceil(Math.max(width, height) * .02));
    const axis = (start: number, end: number, size: number) => {
      const a = Math.max(0, start - safety), b = Math.min(size, end + safety + 1);
      const length = Math.max(b - a, Math.ceil(size / 1.18));
      const offset = Math.max(0, Math.min(size - length, Math.floor((a + b - length) / 2)));
      return [offset, length];
    };
    const [x, w] = axis(left, right, width), [y, h] = axis(top, bottom, height);
    crop = { left: x, top: y, width: w, height: h };
  }
  const buffer = await sharp(data, { raw: { width, height, channels } }).extract(crop).flatten({ background: '#ffffff' })
    .resize(140, 140, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
  return { buffer, crop, original: { width, height } };
}

export function trustedOrderImageUrl(source: string) {
  try {
    const url = new URL(source);
    // Local review deliberately has no storage credentials/configuration.
    // Read only the existing public catalogue HTTPS URLs in that environment.
    const allowedOrigin = process.env.SUPABASE_URL ? url.origin === new URL(process.env.SUPABASE_URL).origin
      : process.env.NODE_ENV !== 'production' && /^[a-z]{20}\.supabase\.co$/.test(url.hostname) && !url.port;
    return url.protocol === 'https:' && allowedOrigin && !url.username && !url.password
      && url.pathname.startsWith('/storage/v1/object/public/product-images/');
  } catch { return false; }
}

/** Stable public image URL; no customer data or credentials go into the HTML. */
export function orderProductThumbnail(image?: { id?: number; url: string; width?: number | null; height?: number | null }) {
  if (!image?.id || !trustedOrderImageUrl(image.url)) return null;
  return { imageUrl: `https://cronox.es/api/email/order-product-image/${image.id}.png?v=1`, imageWidth: 70, imageHeight: 70 };
}
