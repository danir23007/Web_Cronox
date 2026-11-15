import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderMail } from './mail-renderer';
import { prepareOrderShippedDocument, prepareOrderShippedHtml } from './order-shipped-design';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { containedOrderImage } from './order-product-image';

const legacy = readFileSync(join(__dirname, '../templates/order-shipped.hbs'), 'utf8');
describe('ORDER_SHIPPED targeted email presentation', () => {
  it.each(['imported', 'blocks'])('renders matching clickable buttons and both photo orientations (%s)', format => {
    const doc = format === 'blocks' ? structuredDocumentForPurpose('ORDER_SHIPPED')! : {blocks:[{type:'html', html:legacy}]};
    const before = JSON.stringify(doc);
    for (const order of [true, false]) for (const store of [true, false]) {
      const html = renderMail(doc, 'Envío', '', 'ORDER_SHIPPED', {
        orderUrl:order ? 'https://example.test/order?x=1&y=2' : '', storeUrl:store ? 'https://example.test/store' : '', trackingUrl:'https://example.test/tracking',
        items:[[600,1200],[1200,600]].map(([w,h])=>({name:'Prenda',imageUrl:'https://example.test/photo.png',...containedOrderImage(w,h)})),
      }).html;
      const dom = new JSDOM(html).window.document;
      const row = dom.querySelector('.order-shipped-actions')!;
      expect(row.querySelectorAll('a')).toHaveLength(Number(order)+Number(store));
      expect(row.querySelectorAll('.order-action-or')).toHaveLength(order && store ? 1 : 0);
      const anchors = [...row.querySelectorAll('a')];
      if (anchors.length === 2) expect(anchors[0].getAttribute('style')).toBe(anchors[1].getAttribute('style'));
      for (const anchor of anchors) expect(anchor.getAttribute('style')).toContain('border-top:13px solid');
      expect(html).toContain('width="35" height="70"'); expect(html).toContain('width="70" height="35"');
      expect(html).not.toContain('object-fit'); expect(html).not.toContain('{{');
      expect(dom.querySelector('a[href="https://example.test/tracking"]')).toBeTruthy();
    }
    expect(JSON.stringify(doc)).toBe(before);
    expect(prepareOrderShippedDocument(prepareOrderShippedDocument(doc))).toEqual(prepareOrderShippedDocument(doc));
  });
  it('preserves custom branding and leaves other purposes alone', () => {
    const source = legacy.replace('#0b0b0b', '#b1001a');
    expect(prepareOrderShippedHtml(source)).toContain('background:#b1001a');
    expect(prepareOrderShippedHtml(prepareOrderShippedHtml(source))).toBe(prepareOrderShippedHtml(source));
    expect(renderMail({blocks:[{type:'html',html:legacy}]}, 'Otro', '', 'ORDER_DELIVERED').html).not.toContain('order-shipped-actions');
  });
});
