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
  it('uses the same estimate for the whole cart, all quantities and date changes; omits empty/invalid carts', () => {
    const test = setup('2026-09-30T22:30:00Z');
    const delivery = (test.dom.window as any).CRONOX_DELIVERY;
    expect(delivery.estimateCart({ items: [{ qty: 1 }, { qty: 5 }] })).toBe(test.text());
    expect(delivery.estimateCart({ items: [{ qty: 9 }] })).toBe(test.text());
    expect(delivery.estimateCart({ items: [] })).toBeNull();
    expect(delivery.estimateCart(null)).toBeNull();
    expect(delivery.estimateCart({ items: [{ qty: 0 }] })).toBeNull();
    test.set('2026-10-02T12:00:00Z');
    test.tick();
    expect(delivery.estimateCart({ items: [{ qty: 1 }] })).toBe('6 de octubre');
    test.dom.window.close();
  });
  it.each([
    ['2026-10-05T12:00:00Z', '8 de octubre'], // No exceptions.
    ['2026-10-02T12:00:00Z', '6 de octubre'], // Saturday + Sunday = one block.
    ['2026-11-06T12:00:00Z', '11 de noviembre'], // Local holiday within interval.
    ['2026-11-08T12:00:00Z', '12 de noviembre'], // Holiday strictly between order and initial delivery.
    ['2026-10-09T12:00:00Z', '14 de octubre'], // Initial delivery on a regional holiday.
    ['2026-04-28T12:00:00Z', '4 de mayo'], // Extension: holiday + weekend + holiday on Saturday.
    ['2026-05-12T12:00:00Z', '17 de mayo'], // Local holiday extends into a weekend; Sunday is allowed.
    ['2026-05-01T12:00:00Z', '6 de mayo'], // Order holiday excluded.
    ['2026-10-04T12:00:00Z', '7 de octubre'], // Order Sunday excluded.
    ['2026-12-30T12:00:00Z', '4 de enero'], // Verified 2026 -> 2027 calendar.
    ['2027-02-26T12:00:00Z', '2 de marzo'],
    ['2026-09-30T22:30:00Z', '5 de octubre'], // Madrid date differs from UTC.
    ['2026-03-27T23:30:00Z', '1 de abril'],
    ['2026-10-23T22:30:00Z', '28 de octubre'],
    ['2027-03-16T12:00:00Z', '21 de marzo'], // San Jose is official in 2027.
    ['2027-08-13T12:00:00Z', '18 de agosto'], // Official Monday substitution.
  ])('%s → %s', (instant, expected) => {
    const test = setup(instant);
    expect(test.text()).toBe(expected);
    expect(test.dom.window.document.querySelector('p')!.hidden).toBe(false);
    test.dom.window.close();
  });
  it.each([
    ['2026-03-28T23:00:00Z', 23, '5 de abril'],
    ['2026-10-24T22:00:00Z', 25, '29 de octubre'],
  ])('updates at midnight after the DST day %s', (instant, hours, expected) => {
    const test = setup(instant);
    expect(test.delay()).toBe(Number(hours) * 3600000);
    test.advance(test.delay()); test.tick();
    expect(test.text()).toBe(expected);
    test.dom.window.close();
  });
  it.each(['2028-02-26T12:00:00Z', '2027-12-29T12:00:00Z'])('hides both estimates when the extended interval requires an unverified year: %s', instant => {
    const test = setup(instant);
    const delivery = (test.dom.window as any).CRONOX_DELIVERY;
    expect(delivery.estimateProduct()).toBeNull();
    expect(delivery.estimateCart({ items: [{ qty: 1 }] })).toBeNull();
    expect(test.text()).toBe('');
    expect(test.dom.window.document.querySelector('p')!.hidden).toBe(true);
    test.dom.window.close();
  });
  it.each(['focus', 'pageshow', 'visibilitychange'])('refreshes after returning via %s', event => {
    const test = setup('2026-09-30T12:00:00Z');
    test.set('2026-10-02T12:00:00Z');
    Object.defineProperty(test.dom.window.document, 'hidden', { value: false });
    const target = event === 'visibilitychange' ? test.dom.window.document : test.dom.window;
    target.dispatchEvent(new test.dom.window.Event(event));
    expect(test.text()).toBe('6 de octubre');
    test.dom.window.close();
  });
});
