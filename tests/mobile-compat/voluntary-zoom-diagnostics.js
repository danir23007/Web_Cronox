/* Manual, opt-in diagnostic. Never import from public HTML or app bundles.
 * Loading only defines the API. start() asks consent; no network or storage.
 * Measurements live in memory for 30 seconds (max 300 samples).
 */
(() => {
  'use strict';
  if (window.CRONOXZoomDiagnostic) return;
  let running = false, started = 0, samples = [], removers = [], timer, deadline;
  const number = value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : null;
  const box = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: number(r.x), y: number(r.y), width: number(r.width), height: number(r.height) };
  };
  const styles = element => {
    if (!element) return null;
    const s = getComputedStyle(element);
    const adjust = s.textSizeAdjust || s.webkitTextSizeAdjust || '';
    // Whitelist numeric/known values; never collect DOM attributes or text.
    return {
      fontSize: number(parseFloat(s.fontSize)), lineHeight: number(parseFloat(s.lineHeight)),
      zoom: number(parseFloat(s.zoom)),
      textSizeAdjust: /^(auto|none|[\d.]+%)$/.test(adjust) ? adjust : null,
      transformed: s.transform !== 'none', visible: !!element.getClientRects().length && s.visibility !== 'hidden',
    };
  };
  const viewportMeta = () => Array.from(document.querySelectorAll('meta[name="viewport"]'), element => {
    const result = {};
    for (const entry of element.content.split(/[,;]/)) {
      const [key, raw] = entry.trim().toLowerCase().split(/\s*=\s*/);
      if (!['width', 'height', 'initial-scale', 'minimum-scale', 'maximum-scale', 'user-scalable'].includes(key)) continue;
      if (/^(device-width|device-height|yes|no|[\d.]+)$/.test(raw || '')) result[key] = raw;
    }
    return result;
  });
  const probe = selector => {
    const el = document.querySelector(selector);
    return el ? { box: box(el), style: styles(el) } : null;
  };
  const measure = reason => {
    if (!running || !document.documentElement) return null;
    const d = document.documentElement, active = document.activeElement, v = window.visualViewport;
    const heading = document.querySelector('.newsletter-modal-title, h1');
    let glyphBox = null;
    if (heading) {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const r = range.getBoundingClientRect();
      glyphBox = { width: number(r.width), height: number(r.height) };
      range.detach();
    }
    const sample = {
      elapsedMs: number(performance.now() - started), reason,
      viewportMeta: viewportMeta(), innerWidth, innerHeight,
      clientWidth: d.clientWidth, scrollWidth: d.scrollWidth,
      devicePixelRatio: number(devicePixelRatio), screen: { width: screen.width, height: screen.height },
      visual: v ? { width: number(v.width), height: number(v.height), scale: number(v.scale), offsetLeft: number(v.offsetLeft), offsetTop: number(v.offsetTop) } : null,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      root: styles(d), body: styles(document.body),
      active: active ? { kind: /^(INPUT|SELECT|TEXTAREA|BUTTON|A|BODY)$/.test(active.tagName) ? active.tagName : 'OTHER', box: box(active), style: styles(active) } : null,
      probes: { heading: probe('.newsletter-modal-title, h1'), headingGlyphBox: glyphBox, newsletter: probe('.newsletter-modal-overlay'), auth: probe('#authOverlay'), accreditation: probe('.crx-metacrilatos'), footer: probe('footer') },
    };
    samples.push(sample);
    if (samples.length > 300) samples.shift();
    return sample;
  };
  const listen = (target, event, reason = event) => {
    if (!target) return;
    const handler = () => measure(reason);
    target.addEventListener(event, handler);
    removers.push(() => target.removeEventListener(event, handler));
  };
  const stop = () => {
    if (running) measure('stop');
    running = false;
    clearInterval(timer);
    clearTimeout(deadline);
    removers.forEach(remove => remove());
    removers = [];
  };
  window.CRONOXZoomDiagnostic = Object.freeze({
    start() {
      if (running) return false;
      if (!window.confirm('Diagnóstico voluntario durante 30 segundos: solo medidas de pantalla, foco y estilos en memoria. Sin textos, datos de formularios, URL, cookies ni envíos. Puedes detenerlo con CRONOXZoomDiagnostic.stop(). ¿Iniciar?')) return false;
      samples = []; started = performance.now(); running = true;
      listen(document, 'DOMContentLoaded'); listen(window, 'load'); listen(window, 'pageshow');
      listen(window, 'resize'); listen(window, 'orientationchange'); listen(document, 'focusin'); listen(document, 'focusout');
      listen(window.visualViewport, 'resize', 'visual-resize');
      listen(window.visualViewport, 'scroll', 'visual-scroll');
      if (document.fonts) listen(document.fonts, 'loadingdone', 'fonts-ready');
      // Observe only viewport metadata, never body text, input values or account data.
      if (document.head) {
        const observer = new MutationObserver(records => {
          if (records.some(r => r.target.matches?.('meta[name="viewport"]') || Array.from(r.addedNodes).some(n => n.matches?.('meta[name="viewport"]')))) measure('viewport-meta');
        });
        observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['name', 'content'] });
        removers.push(() => observer.disconnect());
      }
      timer = setInterval(() => measure('interval'), 250);
      deadline = setTimeout(stop, 30000);
      measure('start');
      return true;
    },
    mark: () => measure('manual'), stop,
    exportJSON: () => JSON.stringify({ version: 1, running, samples }, null, 2),
    clear() { stop(); samples = []; },
  });
})();
