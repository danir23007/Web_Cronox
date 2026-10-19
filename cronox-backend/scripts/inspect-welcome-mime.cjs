'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { simpleParser } = require('mailparser');
const { parseDocument } = require('htmlparser2');
const normalized = text => text.replace(/\r\n/g, '\n');

// Read-only inspection: no MIME rewriting, SMTP, database or URL fetches.
async function inspectWelcomeMime(raw, expected) {
  const parsed = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  assert.equal(parsed.subject, expected.subject);
  assert.equal(parsed.from.value[0].address, 'no-reply@cronox.es');
  assert.deepEqual(parsed.to.value.map(value => value.address), [expected.to]);
  assert.ok(parsed.messageId && /^<[^<>\s]+@[^<>\s]+>$/.test(parsed.messageId));
  assert.ok(!parsed.headers.has('in-reply-to') && !parsed.headers.has('references'));
  assert.equal(normalized(parsed.html), normalized(expected.html), 'MIME must preserve final rendered HTML');
  assert.equal(normalized(parsed.text).trimEnd(), normalized(expected.text).trimEnd());
  const htmlBytes = Buffer.byteLength(parsed.html, 'utf8');
  assert.ok(htmlBytes < 80 * 1024);
  const elements = [];
  const visit = node => { if (node.type === 'tag') elements.push(node); node.children?.forEach(visit); };
  visit(parseDocument(parsed.html));
  assert.equal(elements.filter(node => node.name === 'html').length, 1);
  assert.equal(elements.filter(node => node.name === 'body').length, 1);
  assert.ok(!elements.some(node => node.name === 'blockquote' || node.attribs.type === 'cite' || /\bgmail_(?:quote|extra)\b/.test(node.attribs.class || '')));
  const backdrop = elements.find(node => node.attribs.class === 'welcome-backdrop');
  assert.ok(backdrop);
  const body = elements.find(node => node.name === 'body');
  const bodyPaintedCanvas = /(?:^|\s)mail-body-canvas(?:\s|$)/.test(body.attribs.class || '');
  if (bodyPaintedCanvas) {
    assert.equal(body.attribs.bgcolor, '#aaa9a6');
    assert.ok(body.attribs.style.includes('background:#aaa9a6;'));
    assert.ok(elements.some(node => node.name === 'meta' && node.attribs.name === 'color-scheme' && node.attribs.content === 'light only'));
    assert.ok(!parsed.html.includes(':root{color-scheme:light dark;}'));
  }
  let outerLevels = 0;
  for (let node = backdrop; node; node = node.parent) {
    if (node.type !== 'tag' || !['html', 'body', 'table', 'td'].includes(node.name)) continue;
    const style = node.attribs.style || '';
    // CSS canvas propagation uses the BODY background when HTML is unpainted.
    // Explicit opt-in only; all tables/cells/body must still be gray.
    if (bodyPaintedCanvas && node.name === 'html') { assert.equal(style, ''); continue; }
    assert.ok(!/background(?:-color)?\s*:\s*(?:white|#fff(?:fff)?)(?:;|$)/i.test(style));
    assert.ok(!/border(?:-left|-right)?\s*:\s*[1-9]|box-shadow|padding\s*:\s*[1-9]|margin\s*:\s*-?[1-9]/i.test(style));
    assert.ok(node.attribs.bgcolor === '#aaa9a6' || style.includes('background-color:#aaa9a6'), 'Every controlled outside surface must declare gray');
    if (node.name === 'table') {
      assert.equal(node.attribs.cellspacing, '0'); assert.equal(node.attribs.cellpadding, '0'); assert.equal(node.attribs.border, '0');
    }
    outerLevels++;
  }
  assert.equal(elements.filter(node => node.name === 'table' && node.attribs.width === '600').length, 1);
  return { messageId: parsed.messageId, htmlBytes, mimeBytes: raw.length, htmlSha256: createHash('sha256').update(normalized(parsed.html)).digest('hex'), mimeSha256: createHash('sha256').update(raw).digest('hex'), quoteStructures: 0, replyHeaders: 0, fullDocuments: 1, readingFrames: 1, grayOuterLevels: outerLevels, bodyPaintedCanvas };
}
module.exports = { inspectWelcomeMime };
