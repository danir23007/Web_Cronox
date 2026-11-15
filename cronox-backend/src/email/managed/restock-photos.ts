import { getFrontendUrl } from '../../common/config/environment';
import type { MailBlock, MailDocument } from './mail-renderer';

type Photo = { id?: number; url: string; variants?: unknown; isPrimary?: boolean; sortOrder?: number; isActive?: boolean; archivedAt?: unknown };

const publicUrl = (value: unknown) => {
  try {
    const url = new URL(typeof value === 'string' ? value : '', getFrontendUrl());
    return value && url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

/** Same ordering, deduplication and quick preset as CRONOX_IMAGES.productRecords /
 * resolve(record, 'quick'). Variants are sizes; their gallery belongs to product. */
export function restockPhotos(product: { images?: Photo[]; imageUrl?: string | null }) {
  const seen = new Set<string>();
  return [...(product.images || []).filter(p => p.isActive !== false && !p.archivedAt)
    .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary) || (a.sortOrder || 0) - (b.sortOrder || 0)),
    ...(product.imageUrl ? [{ url: product.imageUrl }] : [])]
    .filter(photo => {
      const url = publicUrl(photo.url);
      if (!url || seen.has(url) || /\/(?:logo_banner|logo_browser)\.png(?:$|[?#])|\/(?:customer-)?product-image-unavailable\.svg(?:$|[?#])/i.test(url)) return false;
      seen.add(url); return true;
    }).slice(0, 2);
}

export function restockQuickSource(photo: Photo) {
  return publicUrl((photo.variants as any)?.quick?.url) || publicUrl(photo.url);
}

export function restockPhotoData(product: { images?: Photo[]; imageUrl?: string | null }) {
  const urls = restockPhotos(product).map(photo => photo.id
    ? new URL(`/api/email/restock-product-image/${photo.id}.png?v=2`, getFrontendUrl()).href
    : restockQuickSource(photo));
  return { restockPhoto1: urls[0] || '', restockPhoto2: urls[1] || '' };
}

// Fixed table columns never use mail-column (which intentionally stacks on mobile).
// The contain PNGs include transparent padding, so Outlook needs no object-fit.
export const RESTOCK_PHOTOS_HTML = '{{#if restockPhoto1}}<table class="restock-photos" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>' +
  '{{#if restockPhoto2}}<td width="50%" valign="middle" style="padding:0 1px 0 0"><img src="{{restockPhoto1}}" alt="{{product}} · Foto 1" width="280" style="display:block;width:100%;height:auto"></td><td width="50%" valign="middle" style="padding:0 0 0 1px"><img src="{{restockPhoto2}}" alt="{{product}} · Foto 2" width="280" style="display:block;width:100%;height:auto"></td>' +
  '{{else}}<td align="center"><img src="{{restockPhoto1}}" alt="{{product}}" width="280" style="display:block;width:100%;max-width:280px;height:auto;margin:0 auto"></td>{{/if}}</tr></table>{{/if}}';

/** Add only the photo block; keep copy, links, surfaces and signature intact. */
export function prepareRestockDocument<T>(document: T): T {
  const copy = JSON.parse(JSON.stringify(document)) as T & MailDocument;
  const previous = RESTOCK_PHOTOS_HTML.replace('padding:0 1px 0 0', 'padding:0 2px 0 0').replace('padding:0 0 0 1px', 'padding:0 0 0 2px');
  const normalize = (blocks: MailBlock[]) => blocks.forEach(block => {
    if (block.html) block.html = block.html.replace(previous, RESTOCK_PHOTOS_HTML);
    block.columns?.forEach(normalize);
  });
  if (Array.isArray(copy?.blocks)) normalize(copy.blocks);
  if (!Array.isArray(copy?.blocks) || JSON.stringify(copy.blocks).includes('restockPhotos') || JSON.stringify(copy.blocks).includes('restockPhoto1')) return copy;
  let placed = false;
  const visit = (blocks: MailBlock[]) => {
    for (let i = 0; i < blocks.length && !placed; i++) {
      const block = blocks[i];
      if (block.type === 'heading') {
        blocks.splice(i + 1, 0, { type: 'restockPhotos', background: block.background,
          padding: 0, paddingLeft: block.paddingLeft ?? block.padding ?? 0,
          paddingRight: block.paddingRight ?? block.padding ?? 0, paddingBottom: 10, condition: 'restockPhoto1' });
        placed = true;
      } else if (block.type === 'html' && block.html && /<h[12]\b[^>]*>[\s\S]*?<\/h[12]>/i.test(block.html)) {
        block.html = block.html.replace(/(<h[12]\b[^>]*>[\s\S]*?<\/h[12]>)/i, '$1' + RESTOCK_PHOTOS_HTML);
        placed = true;
      } else block.columns?.forEach(visit);
    }
  };
  visit(copy.blocks);
  return copy;
}
