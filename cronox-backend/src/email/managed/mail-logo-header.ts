import { parseDocument } from 'htmlparser2';
import type { MailBlock, MailDocument } from './mail-renderer';

// Production identity. The archived legacy welcome with a similar name is
// intentionally NOT excluded: this exception belongs to one specific card.
export const APPROVED_WELCOME_TEMPLATE_ID = 'cmvf0j8780001l296e24fam0c';
export const MAIL_LOGO_WHITE = 'https://cronox.es/assets/mail/order-confirmation/logo-dark.png';
export const MAIL_LOGO_BLACK = 'https://cronox.es/assets/mail/order-confirmation/logo-light.png';
export const NOREPLY_HEADER_PURPOSES = new Set(['CART_ABANDONED', 'PASSWORD_RESET', 'PASSWORD_SETUP_NEW_ACCOUNT', 'PASSWORD_SETUP_EXISTING_ACCOUNT', 'INITIAL_PASSWORD_SETUP', 'NEWSLETTER_ACCESS', 'NEWSLETTER_WELCOME', 'RESTOCK', 'TEST']);
const officialLogo = (src = '') => [MAIL_LOGO_WHITE, MAIL_LOGO_BLACK].includes(src);

function lightSurface(background: string) {
  const match = background.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return /white|rgb\(\s*2[3-5]\d/i.test(background);
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return .2126 * parseInt(hex.slice(0, 2), 16) + .7152 * parseInt(hex.slice(2, 4), 16) + .0722 * parseInt(hex.slice(4, 6), 16) > 150;
}

/** Same cropped official asset, 148 px width and 24 px logo/title gap as reset. */
export function noreplyLogoBlock(background = '#151519', left = 0, titleTop = 0): MailBlock {
  return { type: 'image', src: lightSurface(background) ? MAIL_LOGO_BLACK : MAIL_LOGO_WHITE,
    alt: 'CRONOX', width: 148, background, align: 'left', padding: 0,
    ...(left ? { paddingLeft: left } : {}), paddingBottom: Math.max(0, 24 - titleTop) };
}

/** Edit only the header of a disposable document; no copy, links or footer edits. */
export function withMailLogoHeader<T extends MailDocument>(document: T, templateId?: string): T {
  if (templateId === APPROVED_WELCOME_TEMPLATE_ID) return document;
  const copy = JSON.parse(JSON.stringify(document)) as T;
  let placed = false;
  const visit = (blocks: MailBlock[], inherited = '#111111'): boolean => {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index], background = block.background || inherited;
      if (block.type === 'html' && block.html) {
        block.html = withMailLogoHtmlHeader(block.html); placed = true; return true;
      }
      if (block.type === 'heading' && block.text?.trim() === 'CRONOX') {
        // Existing order header: replace the brand in its left-hand column,
        // leaving the order-number column and all body content in place.
        const padding = block.paddingLeft ?? block.padding ?? 0;
        blocks[index] = { ...noreplyLogoBlock(background), padding: block.padding ?? 0,
          paddingLeft: padding, paddingTop: block.paddingTop ?? block.padding ?? 0,
          paddingBottom: block.paddingBottom ?? block.padding ?? 0 };
        placed = true; return true;
      }
      if (block.type === 'heading' || officialLogo(block.src)) {
        const heading = blocks.slice(index).find(b => b.type === 'heading');
        if (officialLogo(block.src) && !heading) {
          // A logo-only column (order header/new empty template) retains its
          // own padding instead of acquiring the body title's 24 px gap.
          blocks[index] = { ...block, src: lightSurface(background) ? MAIL_LOGO_BLACK : MAIL_LOGO_WHITE, width: 148, alt: 'CRONOX' };
          placed = true; return true;
        }
        const left = heading?.paddingLeft ?? heading?.padding ?? 0;
        const top = heading?.paddingTop ?? heading?.padding ?? 0;
        const logo = noreplyLogoBlock(background, left, top);
        if (officialLogo(block.src)) {
          if (block.src !== logo.src || block.width !== 148 || (block.paddingLeft ?? block.padding ?? 0) !== left || block.paddingBottom !== logo.paddingBottom)
            blocks[index] = { ...block, ...logo };
        }
        else blocks.splice(index, 0, logo);
        placed = true; return true;
      }
      if (block.columns) {
        const orderHeader = block.type === 'columns' && block.columns.some(column => column.some(child => child.type === 'heading' && child.text?.trim() === 'CRONOX'));
        for (const column of block.columns) if (visit(column, background)) {
          if (orderHeader) block.orderHeader = true; // Keep number at the right on mobile too.
          return true;
        }
      }
    }
    return false;
  };
  visit(copy.blocks);
  if (!placed) copy.blocks.unshift({ type: 'section', background: '#151519', color: '#eeeeee', padding: 28, columns: [[noreplyLogoBlock()]] });
  return copy;
}

/** Source-offset edits preserve imported HTML/Handlebars byte for byte elsewhere. */
export function withMailLogoHtmlHeader(html: string): string {
  const tree = parseDocument(html, { withStartIndices: true, withEndIndices: true });
  const elements: any[] = [];
  const walk = (node: any) => { if (node.type === 'tag') elements.push(node); node.children?.forEach(walk); };
  walk(tree);
  const brand = elements.find(node => ['p', 'div', 'h1', 'h2', 'span'].includes(node.name) && node.children?.every((c: any) => c.type === 'text') && node.children.map((c: any) => c.data).join('').trim() === 'CRONOX');
  const heading = elements.find(node => /^h[12]$/.test(node.name));
  if (!heading && !brand) return html;
  const anchor = brand && (!heading || brand.startIndex <= heading.startIndex) ? brand : heading;
  const previous = elements.filter(node => node.startIndex < anchor.startIndex);
  const logos = previous.filter(node => node.name === 'img' && officialLogo(node.attribs.src));
  if (logos.length === 1) {
    const parent = logos[0].parent;
    if (parent?.name === 'div' && parent.attribs?.style === 'margin:0;padding:0 0 24px;text-align:left;') {
      const end = html.indexOf('>', parent.startIndex) + 1;
      return html.slice(0, parent.startIndex) + html.slice(parent.startIndex, end).replace('padding:0 0 24px', 'padding:0 0 26px') + html.slice(end);
    }
    return html; // Reset's exact existing header is already correct.
  }
  let background = '#111111';
  for (let node = anchor; node; node = node.parent) {
    const style = node.attribs?.style || '';
    const value = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*(#[\da-f]{3,8}|white|black|rgb\([^)]*\))/i)?.[1] || node.attribs?.bgcolor;
    if (value) { background = value; break; }
  }
  const src = lightSurface(background) ? MAIL_LOGO_BLACK : MAIL_LOGO_WHITE;
  const img = `<img src="${src}" alt="CRONOX" width="148" style="display:block;width:148px;max-width:100%;height:auto;border:0;">`;
  if (anchor === brand) {
    let result = html.slice(0, brand.startIndex) + img + html.slice(brand.endIndex + 1);
    let cell = brand.parent;
    while (cell && cell.name !== 'td') cell = cell.parent;
    if (cell?.parent?.children?.filter((n: any) => n.name === 'td').length === 2) {
      const end = html.indexOf('>', cell.startIndex) + 1;
      const opening = html.slice(cell.startIndex, end);
      const sized = /\bwidth\s*=/.test(opening) ? opening.replace(/\bwidth\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/, 'width="148"') : opening.replace(/>$/, ' width="148">');
      result = result.slice(0, cell.startIndex) + sized + result.slice(end);
    }
    return result;
  }
  // Visual tables add 2 px cellspacing to reset's 24 px padding.
  const image = `<div style="margin:0;padding:0 0 26px;text-align:left;">${img}</div>`;
  const edits: Array<{ start: number; end: number; value: string }> = [];
  edits.push({ start: heading.startIndex, end: heading.startIndex, value: image });
  const openingEnd = html.indexOf('>', heading.startIndex) + 1;
  const opening = html.slice(heading.startIndex, openingEnd);
  const adjusted = /\bstyle\s*=/.test(opening)
    ? opening.replace(/(\bstyle\s*=\s*["'])([^"']*)/, '$1$2;margin-top:0;')
    : opening.replace(/>$/, ' style="margin-top:0;">');
  edits.push({ start: heading.startIndex, end: openingEnd, value: adjusted });
  // At the same offset replace the heading first, then prepend the logo.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  return html;
}
