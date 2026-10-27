// Injected only by the local browser harness, never shipped to customers.
function installDiagnostics() {
 window.__CRONOX_API_BASE__ = location.origin;
 window.compatSamples = [];
 window.compatMeasure = reason => {
  if (!document.documentElement || !document.body) return;
  const d = document.documentElement, active = document.activeElement;
  const style = active && getComputedStyle(active);
  const offenders = [...document.querySelectorAll('body *')].flatMap(el => {
   const r = el.getBoundingClientRect(), s = getComputedStyle(el);
   if (!r.width || !r.height || (r.left >= -1 && r.right <= d.clientWidth + 1)) return [];
   const clippedBy = el.parentElement?.closest('[hidden],[aria-hidden="true"]');
   return [{ tag: el.tagName, id: el.id, class: String(el.className).slice(0, 120), x: r.x, right: r.right, width: r.width, scrollWidth: el.scrollWidth, display: s.display, visibility: s.visibility, position: s.position, transform: s.transform, hiddenAncestor: clippedBy?.id || clippedBy?.className || null }];
  });
  const sample = { reason, time: performance.now(), viewport: [...document.querySelectorAll('meta[name="viewport"]')].map(e => e.content), innerWidth, clientWidth: d.clientWidth, scrollWidth: d.scrollWidth, visual: window.visualViewport && { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale }, active: active && { tag: active.tagName, id: active.id, fontSize: style.fontSize, textSizeAdjust: style.textSizeAdjust || style.webkitTextSizeAdjust, transform: style.transform }, offenders };
  window.compatSamples.push(sample);
  return sample;
 };
 document.addEventListener('DOMContentLoaded', () => {
  compatMeasure('DOMContentLoaded');
  new MutationObserver(() => compatMeasure('viewport mutation')).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'content'] });
  document.fonts?.ready.then(() => compatMeasure('fonts ready'));
  [100, 500, 1500, 3500, 6500].forEach(ms => setTimeout(() => compatMeasure('timer ' + ms), ms));
 });
 window.addEventListener('load', () => compatMeasure('load'));
 window.addEventListener('pageshow', event => compatMeasure('pageshow persisted=' + event.persisted));
 window.addEventListener('resize', () => compatMeasure('resize'));
 window.visualViewport?.addEventListener('resize', () => compatMeasure('visualViewport resize'));
 document.addEventListener('focusin', () => compatMeasure('focusin'));
}
module.exports = { installDiagnostics };
