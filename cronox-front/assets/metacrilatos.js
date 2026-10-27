(() => {
  'use strict';

  // Appearance is extracted from the five hash-verified approved HTML files.
  // This renderer never fetches identity, creates credentials, or changes a design.
  const scriptUrl = document.currentScript?.src || new URL('/assets/metacrilatos.js', location.href).href;
  const assetUrl = name => new URL(`metacrilatos/${name}`, scriptUrl).href;
  const cssUrl = new URL('metacrilatos.css?v=4', scriptUrl).href;
  const instances = new WeakMap();
  const roman = ['I', 'II', 'III', 'IV', 'V'];
  let styleReady;

  function ensureStyles() {
    if (styleReady) return styleReady;
    let link = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(item => item.href === cssUrl);
    if (link?.sheet) return (styleReady = Promise.resolve());
    const existing = !!link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
    }
    styleReady = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => finish(false), 15000);
      const loaded = () => finish(true);
      const failed = () => finish(false);
      function finish(success) {
        window.clearTimeout(timer);
        link.removeEventListener('load', loaded);
        link.removeEventListener('error', failed);
        if (success) resolve();
        else {
          link.remove();
          styleReady = null;
          reject(new Error('No se pudo cargar el diseño METACRILATOS. Inténtalo de nuevo.'));
        }
      }
      link.addEventListener('load', loaded, { once: true });
      link.addEventListener('error', failed, { once: true });
    });
    if (!existing) document.head.append(link);
    return styleReady;
  }

  const normalizeName = value => typeof value === 'string' ? value.trim().split(/\s+/u).slice(0, 2).join(' ') : '';
  function formatRegistrationDate(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const day = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
    if (!day) return '';
    const year = Number(day[1]), month = Number(day[2]), date = Number(day[3]);
    if (month < 1 || month > 12 || date < 1 || date > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(parsed);
  }

  function markup() {
    // No customer-controlled string is interpolated into this static template.
    return `<section class="crx-display" aria-label="Acreditación CRONOX encapsulada en metacrilato con reflejos interactivos">
      <div class="crx-stage" role="group" aria-label="Acreditación 3D. Arrastra para girarla o utiliza el botón inferior.">
        <div class="crx-scale"><div class="crx-slab">
          <div class="crx-rim" aria-hidden="true"></div>
          <div class="crx-face crx-front">
            <div class="crx-label"><div class="crx-label-info"><span class="crx-label-title">CRONOX · ACREDITACIÓN</span></div><div class="crx-label-grade crx-label-symbol"><img data-crx-asset="symbol.png" alt="Símbolo CRONOX" draggable="false"></div></div>
            <div class="crx-card">
              <div class="crx-long-logo"><img data-crx-asset="wordmark.png" alt="Logo CRONOX" draggable="false"></div>
              <div class="crx-emblem" role="img"><span class="crx-roman" data-crx-roman></span></div>
              <div class="crx-identity"><div class="crx-name" data-crx-name></div><div class="crx-date" data-crx-date></div></div>
            </div>
          </div>
          <div class="crx-face crx-back" aria-hidden="true">
            <div class="crx-label"><div class="crx-label-info"><span class="crx-label-code" data-crx-id></span></div><div class="crx-label-grade" data-crx-roman></div></div>
            <div class="crx-card crx-card-back">
              <div class="crx-reverse-mark">CRONOX</div>
              <div class="crx-eye-logo"><img data-crx-asset="eye.png" alt="Logo secundario CRONOX" draggable="false"></div>
              <div class="crx-qr" role="img" aria-label="QR personal no disponible"></div>
              <div class="crx-url">www.cronox.es</div>
            </div>
          </div>
        </div></div>
      </div>
      <div class="crx-actions"><button type="button" class="cursor-interaction" data-crx-flip>Ver reverso</button></div>
      <span class="crx-only-accessible" role="status" aria-live="polite" data-crx-status>Vista del anverso.</span>
    </section>`;
  }

  function mount(root, initialData) {
    if (!(root instanceof Element)) throw new TypeError('Falta el contenedor de la acreditación.');
    instances.get(root)?.destroy();
    let destroyed = false;
    let revision = 0;
    let disposeScene = () => {};
    let ready = Promise.resolve();
    root.classList.add('crx-metacrilatos');
    const api = {
      update,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        revision += 1;
        disposeScene();
        root.replaceChildren();
        root.classList.remove('crx-metacrilatos');
        delete root.dataset.crxLevel;
        root.style.removeProperty('--crx-scale');
        if (instances.get(root) === api) instances.delete(root);
      },
      get ready() { return ready; },
    };
    instances.set(root, api);

    function update(data = {}) {
      if (destroyed) return Promise.resolve();
      const currentRevision = ++revision;
      disposeScene();
      disposeScene = () => {};
      const level = data.circleLevel;
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        delete root.dataset.crxLevel;
        const notice = document.createElement('p');
        notice.className = 'crx-unavailable';
        notice.setAttribute('role', 'status');
        notice.textContent = 'Acreditación no disponible: círculo sin asignar.';
        root.replaceChildren(notice);
        ready = Promise.resolve();
        return ready;
      }
      root.dataset.crxLevel = String(level);
      root.innerHTML = markup();
      const slab = root.querySelector('.crx-slab');
      const stage = root.querySelector('.crx-stage');
      const rim = root.querySelector('.crx-rim');
      const front = root.querySelector('.crx-front');
      const back = root.querySelector('.crx-back');
      const flip = root.querySelector('[data-crx-flip]');
      const status = root.querySelector('[data-crx-status]');
      const emblem = root.querySelector('.crx-emblem');
      const name = root.querySelector('[data-crx-name]');
      const visibleId = root.querySelector('[data-crx-id]');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      const edgePanels = [];
      const cleanups = [];
      let active = true;
      let x = -7, y = -19, dragging = false, previousX = 0, previousY = 0, pointerId = null;
      let directManipulation = false;
      // One frame loop owns all rotation; one deadline owns idle resumption.
      // Hiding the scene suspends work without losing its orientation/deadline.
      let automatic = true, frame = 0, lastTime = null, turn = null;
      let layoutFrame = 0;
      let resumeTimer = 0, resumeAt = null, sceneReady = false, pageActive = true;
      let resumeGeneration = 0;
      let intersecting = typeof IntersectionObserver !== 'function';
      const on = (target, type, listener, options) => {
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
      };
      root.querySelectorAll('[data-crx-roman]').forEach(element => { element.textContent = roman[level - 1]; });
      name.textContent = normalizeName(data.name);
      name.title = name.textContent;
      root.querySelector('[data-crx-date]').textContent = formatRegistrationDate(data.createdAt);
      // The public code is already issued: preserve it verbatim, including
      // prefixes and leading zeroes. Administrative numbers are not this ID.
      visibleId.textContent = window.CRONOX_USER_IDENTITY.format(data);
      visibleId.title = visibleId.textContent;
      emblem.setAttribute('aria-label', `Círculo ${roman[level - 1]}: ${level === 1 ? 'un círculo' : `${level} círculos concéntricos`}`);
      for (let i = 0; i < level; i++) {
        const ring = document.createElement('span');
        ring.className = 'crx-ring';
        ring.style.inset = `${i * 10}px`;
        ring.style.opacity = String(.35 + i * .12);
        ring.setAttribute('aria-hidden', 'true');
        emblem.insertBefore(ring, emblem.firstChild);
      }
      root.querySelectorAll('[data-crx-asset]').forEach(image => {
        image.src = assetUrl(image.dataset.crxAsset.replace('.png', `-${level}.png`));
      });
      // Restrict the authorized graphic to a local PNG data URI. No scanned URL
      // or arbitrary external image is ever opened by the renderer.
      if (typeof data.qrDataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qrDataUrl)) {
        const qr = root.querySelector('.crx-qr');
        const image = document.createElement('img');
        image.alt = 'QR personal de la acreditación';
        image.draggable = false;
        image.src = data.qrDataUrl;
        qr.setAttribute('aria-label', image.alt);
        qr.append(image);
      }

      function fitText(element, available) {
        element.style.fontSize = '';
        element.style.letterSpacing = '';
        const computed = getComputedStyle(element);
        const normal = parseFloat(computed.fontSize);
        const tracking = parseFloat(computed.letterSpacing) || 0;
        if (!available || !Number.isFinite(normal)) return;
        let size = normal;
        // Remove only decorative tracking before shrinking long text.
        if (tracking > 0 && element.scrollWidth > available + .5) element.style.letterSpacing = '0px';
        while (element.scrollWidth > available + .5 && size > 1) {
          size -= .25;
          element.style.fontSize = `${size}px`;
        }
      }
      function fitFields() {
        if (!active) return;
        fitText(name, name.clientWidth);
        const box = visibleId.parentElement;
        const padding = getComputedStyle(box);
        fitText(visibleId, box.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
      }
      function buildRim() {
        if (!active) return;
        const w = slab.offsetWidth, h = slab.offsetHeight, radius = 16, depth = 20;
        if (!w || !h) return;
        const width = root.clientWidth;
        // At normal widths the source remains 1:1. Extra space accommodates
        // perspective and the original 20px thickness during a full turn.
        root.style.setProperty('--crx-scale', String(width ? Math.min(1, width / (w + 24)) : 1));
        const corners = [[radius, radius, 180], [w-radius, radius, 270], [w-radius, h-radius, 0], [radius, h-radius, 90]];
        const points = [];
        for (const [cx, cy, start] of corners) {
          for (let i = 0; i <= 16; i++) {
            const theta = (start + i * 90 / 16) * Math.PI / 180;
            points.push([cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]);
          }
        }
        const sides = document.createDocumentFragment();
        edgePanels.length = 0;
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const length = Math.hypot(dx, dy) + .3;
          const panel = document.createElement('div');
          panel.className = 'crx-rim-panel';
          panel.style.width = `${length}px`;
          panel.style.height = `${depth}px`;
          panel.style.transform = `translate3d(${(a[0]+b[0])/2-length/2}px,${(a[1]+b[1])/2-depth/2}px,0) rotateZ(${Math.atan2(dy,dx)*180/Math.PI}deg) rotateX(90deg)`;
          const tangentLength = Math.hypot(dx, dy);
          edgePanels.push({ element: panel, nx: dy/tangentLength, ny: -dx/tangentLength });
          sides.appendChild(panel);
        }
        rim.replaceChildren(sides);
        [front, back].forEach(face => {
          const card = face.querySelector('.crx-card');
          const label = face.querySelector('.crx-label');
          face.style.setProperty('--crx-field-width', `${face.clientWidth || w-2}px`);
          face.style.setProperty('--crx-field-height', `${face.clientHeight || h-2}px`);
          face.style.setProperty('--crx-card-x', `${-(card.offsetLeft + card.clientLeft || 20)}px`);
          face.style.setProperty('--crx-card-y', `${-(card.offsetTop + card.clientTop || 68)}px`);
          face.style.setProperty('--crx-label-x', `${-(label.offsetLeft + label.clientLeft || 19)}px`);
          face.style.setProperty('--crx-label-y', `${-(label.offsetTop + label.clientTop || 18)}px`);
        });
        fitFields();
        updateLighting();
      }
      function updateLighting() {
        const pitch = x * Math.PI / 180;
        const yaw = y * Math.PI / 180;
        for (const [face, offset] of [[front, 0], [back, 180]]) {
          const localYaw = (y - offset) * Math.PI / 180;
          const side = Math.sin(localYaw), tilt = Math.sin(pitch);
          const facing = Math.abs(Math.cos(localYaw));
          face.style.setProperty('--crx-light-band', `${47 + side*74 + tilt*22}%`);
          face.style.setProperty('--crx-light-angle', `${115 + tilt*22 + side*11}deg`);
          face.style.setProperty('--crx-light-x', `${50 + side*42}%`);
          face.style.setProperty('--crx-light-y', `${18 + tilt*32}%`);
          face.style.setProperty('--crx-light-opacity', String(.46 + .26*(1-facing) + .05*(1+Math.cos(localYaw-.5))));
        }
        for (const edge of edgePanels) {
          const nx = edge.nx * Math.cos(yaw);
          const ny = edge.ny * Math.cos(pitch) + edge.nx * Math.sin(yaw) * Math.sin(pitch);
          const nz = edge.ny * Math.sin(pitch) - edge.nx * Math.sin(yaw) * Math.cos(pitch);
          const light = Math.max(0, -.55*nx - .65*ny + .52*nz);
          edge.element.style.setProperty('--crx-edge-light', String(.025 + .5*Math.pow(light, 5)));
        }
      }
      function render() {
        if (!active) return;
        slab.style.transition = 'none';
        slab.style.transform = `rotateX(${x}deg) rotateY(${y}deg)`;
        updateLighting();
        const onFront = Math.cos(y * Math.PI / 180) >= 0;
        const frontHidden = String(!onFront), backHidden = String(onFront);
        if (front.getAttribute('aria-hidden') !== frontHidden) front.setAttribute('aria-hidden', frontHidden);
        if (back.getAttribute('aria-hidden') !== backHidden) back.setAttribute('aria-hidden', backHidden);
        const flipLabel = onFront ? 'Ver reverso' : 'Ver anverso';
        if (flip.textContent !== flipLabel) flip.textContent = flipLabel;
      }
      function cancelFrame() {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = null;
      }
      function cancelResumeTimer() {
        resumeGeneration += 1;
        window.clearTimeout(resumeTimer);
        resumeTimer = 0;
      }
      function isVisible() {
        return active && sceneReady && pageActive && !document.hidden && intersecting && root.isConnected
          && root.getClientRects().length > 0 && !root.closest('[hidden], .is-loading')
          && getComputedStyle(root).visibility === 'visible';
      }
      function syncMotion() {
        if (!isVisible()) {
          cancelFrame();
          cancelResumeTimer();
          return;
        }
        if (!dragging && resumeAt !== null) {
          const remaining = resumeAt - performance.now();
          if (remaining <= 0) {
            cancelResumeTimer();
            resumeAt = null;
            turn = null;
            automatic = true;
          } else if (!resumeTimer) {
            const generation = resumeGeneration;
            resumeTimer = window.setTimeout(() => {
              if (!active || generation !== resumeGeneration) return;
              resumeTimer = 0;
              syncMotion();
            }, remaining);
          }
        }
        if (!dragging && !reduced.matches && (automatic || turn)) {
          if (!frame) frame = requestAnimationFrame(animate);
        } else cancelFrame();
      }
      function animate(time) {
        frame = 0;
        if (!isVisible()) { syncMotion(); return; }
        const elapsed = lastTime === null ? 0 : Math.max(0, Math.min(time-lastTime, 50));
        lastTime = time;
        let completedTurn = false;
        if (turn) {
          turn.elapsed += elapsed;
          const progress = Math.min(1, turn.elapsed/650);
          const ease = 1-Math.pow(1-progress, 3);
          x = turn.startX * (1-ease);
          y = turn.startY + (turn.targetY-turn.startY)*ease;
          if (progress === 1) { turn = null; completedTurn = true; }
        } else if (automatic) y += elapsed * .021;
        render();
        if (completedTurn) resumeAfterIdle();
        else syncMotion();
      }
      function stopForInteraction() {
        cancelFrame();
        cancelResumeTimer();
        automatic = false;
        turn = null;
        resumeAt = null;
      }
      function resumeAfterIdle() {
        cancelResumeTimer();
        resumeAt = performance.now() + 5000;
        syncMotion();
      }
      function resumeImmediately() {
        cancelResumeTimer();
        resumeAt = null;
        turn = null;
        automatic = true;
        syncMotion();
      }
      function turnTo(targetY) {
        if (reduced.matches) { x = 0; y = targetY; render(); resumeAfterIdle(); return; }
        turn = { startX: x, startY: y, targetY, elapsed: 0 };
        syncMotion();
      }
      on(flip, 'click', () => {
        // An active captured gesture owns the orientation, including on hybrids.
        if (dragging) return;
        stopForInteraction();
        const onFront = Math.cos(y * Math.PI / 180) >= 0;
        const target = onFront ? 180 : 0;
        let delta = ((target-y) % 360 + 360) % 360;
        if (delta > 180) delta -= 360;
        turnTo(y+delta);
        status.textContent = onFront ? 'Vista del reverso.' : 'Vista del anverso.';
      });
      on(stage, 'pointerdown', event => {
        if (event.button !== 0 || dragging) return;
        stopForInteraction();
        dragging = true;
        directManipulation = event.pointerType === 'touch' || event.pointerType === 'pen';
        pointerId = event.pointerId;
        previousX = event.clientX;
        previousY = event.clientY;
        try { stage.setPointerCapture(event.pointerId); } catch { /* Window release handlers cover lost capture. */ }
        slab.style.transition = 'none';
      });
      on(stage, 'pointermove', event => {
        if (!dragging || event.pointerId !== pointerId) return;
        turn = null;
        y += (event.clientX-previousX) * .65;
        x = Math.max(-32, Math.min(32, x-(event.clientY-previousY)*.3));
        previousX = event.clientX;
        previousY = event.clientY;
        render();
      });
      function release(event) {
        if (!dragging || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
        dragging = false;
        const releasedId = pointerId;
        const resumeDirectly = directManipulation;
        directManipulation = false;
        pointerId = null;
        // Clear gesture state before releasing capture: lostpointercapture may
        // fire synchronously and must not create a second idle deadline.
        try { if (stage.hasPointerCapture(releasedId)) stage.releasePointerCapture(releasedId); } catch { /* Already released. */ }
        status.textContent = Math.cos(y * Math.PI / 180) >= 0 ? 'Vista del anverso.' : 'Vista del reverso.';
        if (active) {
          if (resumeDirectly) resumeImmediately();
          else resumeAfterIdle();
        }
      }
      on(stage, 'pointerup', release);
      on(stage, 'pointercancel', release);
      on(stage, 'lostpointercapture', release);
      on(window, 'pointerup', release);
      on(window, 'pointercancel', release);
      on(window, 'blur', () => release());
      on(document, 'visibilitychange', () => {
        if (document.hidden) release();
        syncMotion();
      });
      on(window, 'pagehide', () => { pageActive = false; release(); syncMotion(); });
      on(window, 'pageshow', () => { pageActive = true; syncMotion(); });
      on(reduced, 'change', () => {
        cancelFrame();
        if (reduced.matches && turn) {
          x = 0; y = turn.targetY; turn = null; render(); resumeAfterIdle();
        } else syncMotion();
      });
      // Scaling changes the observed host height. Batch these layout writes
      // after ResizeObserver delivery, without introducing another motion loop.
      const resized = () => {
        if (!active || layoutFrame) return;
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = 0;
          if (!active) return;
          buildRim();
          syncMotion();
        });
      };
      const observer = new ResizeObserver(resized);
      observer.observe(root);
      observer.observe(slab);
      on(window, 'resize', resized);
      const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        intersecting = entries.some(entry => entry.target === root && entry.isIntersecting);
        syncMotion();
      }) : null;
      intersection?.observe(root);
      // Preview starts with body visibility:hidden; profile has a loading
      // overlay. Observe ancestors only, never the styles written by render().
      const visibility = new MutationObserver(syncMotion);
      for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
        visibility.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      }
      const imagesReady = [...root.querySelectorAll('img')].map(image => {
        if (image.complete) return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error('No se pudo cargar una imagen de la acreditación.'));
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => finish(false), 15000);
          const loaded = () => finish(image.naturalWidth > 0);
          const failed = () => finish(false);
          function finish(success, cancelled = false) {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.removeEventListener('load', loaded);
            image.removeEventListener('error', failed);
            if (success || cancelled) resolve();
            else reject(new Error('No se pudo cargar una imagen de la acreditación. Inténtalo de nuevo.'));
          }
          image.addEventListener('load', loaded, { once: true });
          image.addEventListener('error', failed, { once: true });
          cleanups.push(() => finish(false, true));
        });
      });
      disposeScene = () => {
        active = false;
        stopForInteraction();
        cancelAnimationFrame(layoutFrame);
        layoutFrame = 0;
        release();
        observer.disconnect();
        intersection?.disconnect();
        visibility.disconnect();
        cleanups.splice(0).forEach(cleanup => cleanup());
      };
      // A global stylesheet request can be shared by another mounted card.
      // Detaching this card still settles its own ready promise immediately.
      const cancelled = new Promise(resolve => { cleanups.push(resolve); });
      // CSS is inserted lazily. Reading fonts.ready before it loads can resolve
      // before its font faces are used, leaving the fitted identity in fallback
      // metrics. Load the actual face after the stylesheet has applied.
      const typographyReady = ensureStyles().then(async () => {
        if (!active || destroyed || currentRevision !== revision || !document.fonts) return;
        if (document.fonts.load) {
          // A failed webfont must use the declared serif fallback, not make
          // the credential unavailable. CSS/artwork failures still reject.
          await Promise.allSettled([name, visibleId].map(element => {
            const style = getComputedStyle(element);
            return Promise.resolve().then(() => document.fonts.load(
              `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, element.textContent || 'CRONOX',
            ));
          }));
        }
        await document.fonts.ready;
      });
      ready = Promise.race([Promise.all([typographyReady, ...imagesReady]), cancelled]).then(() => {
        if (active && !destroyed && currentRevision === revision) { sceneReady = true; buildRim(); render(); syncMotion(); }
      });
      buildRim();
      render();
      return ready;
    }
    update(initialData);
    return api;
  }
  window.CRONOX_METACRILATOS = Object.freeze({ mount, normalizeName, formatRegistrationDate });
})();
