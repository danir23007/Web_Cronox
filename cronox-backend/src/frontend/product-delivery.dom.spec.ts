import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const script = readFileSync(join(__dirname, '../../../cronox-front/assets/product-delivery.js'), 'utf8');
function setup(instant: string) {
  const dom = new JSDOM('<p data-delivery-notice hidden><strong data-delivery-date></strong></p>', { runScripts: 'outside-only' });
  let now = Date.parse(instant);
  dom.window.Date.now = () => now;
  let callback: () => void;
  let delay = 0;
  dom.window.setTimeout = ((fn: () => void, ms: number) => { callback = fn; delay = ms; return 1; }) as any;
  dom.window.eval(script);
  return { dom, text: () => dom.window.document.querySelector('strong')!.textContent,
    delay: () => delay, advance: (ms: number) => { now += ms; }, tick: () => callback(),
    set: (value: string) => { now = Date.parse(value); } };
}
describe('product delivery calendar in Madrid', () => {
  it.each([
    ['2026-09-30T12:00:00Z', '3 de octubre'],
    ['2026-12-30T12:00:00Z', '2 de enero'],
    ['2028-02-26T12:00:00Z', '29 de febrero'],
    ['2027-02-26T12:00:00Z', '1 de marzo'],
    ['2026-09-30T22:30:00Z', '4 de octubre'],
    ['2026-03-27T23:30:00Z', '31 de marzo'],
    ['2026-10-23T22:30:00Z', '27 de octubre'],
  ])('%s → %s', (instant, expected) => {
    const test = setup(instant);
    expect(test.text()).toBe(expected);
    expect(test.dom.window.document.querySelector('p')!.hidden).toBe(false);
    test.dom.window.close();
  });
  it.each([
    ['2026-03-28T23:00:00Z', 23, '2 de abril'],
    ['2026-10-24T22:00:00Z', 25, '29 de octubre'],
  ])('updates at midnight after the DST day %s', (instant, hours, expected) => {
    const test = setup(instant);
    expect(test.delay()).toBe(Number(hours) * 3600000);
    test.advance(test.delay()); test.tick();
    expect(test.text()).toBe(expected);
    test.dom.window.close();
  });
  it.each(['focus', 'pageshow', 'visibilitychange'])('refreshes after returning via %s', event => {
    const test = setup('2026-09-30T12:00:00Z');
    test.set('2026-10-02T12:00:00Z');
    Object.defineProperty(test.dom.window.document, 'hidden', { value: false });
    const target = event === 'visibilitychange' ? test.dom.window.document : test.dom.window;
    target.dispatchEvent(new test.dom.window.Event(event));
    expect(test.text()).toBe('5 de octubre');
    test.dom.window.close();
  });
});
