(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $('keyGate'),
    loader: $('keyLoader'),
    frame: $('keyMediaFrame'),
    shade: $('keyShade'),
    content: $('keyContent'),
    unavailable: $('keyUnavailable'),
    title: $('keyTitle'),
    subtitle: $('keySubtitle'),
    form: $('keyRegister'),
    email: $('keyEmail'),
    submit: $('keySubmit'),
    message: $('keyFormMessage'),
    success: $('keySuccess'),
    privacy: $('keyPrivacy'),
  };
  const base = String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
  const MEDIA_READY_TIMEOUT_MS = 8000;
  let screen = null;
  let media = null;
  let loaderRemovalTimer = 0;
  let mediaReadyTimer = 0;

  const safeUrl = (value) => {
    try {
      const url = new URL(value, location.origin);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : '';
    } catch {
      return '';
    }
  };

  const privacyUrl = (value) => {
    const safe = safeUrl(value) || `${location.origin}/privacidad`;
    const url = new URL(safe);
    if (
      url.origin === location.origin &&
      ['/privacidad', '/privacy-policy.html'].includes(url.pathname.replace(/\/+$/, ''))
    ) {
      url.pathname = '/privacidad';
      url.searchParams.set('source', 'key-screen');
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  };

  const number = (value, min, max, fallback) =>
    Number.isFinite(Number(value))
      ? Math.min(max, Math.max(min, Number(value)))
      : fallback;
  const renderer = window.CRONOX_KEY_SCREEN_RENDERER;
  const device = () => renderer.deviceForWidth(window.innerWidth);

  const applyViewport = () =>
    renderer.applyViewport(el.gate, window.innerWidth, window.innerHeight);

  const applyMedia = () => {
    if (!media || !screen) return;
    window.CRONOX_MEDIA_GEOMETRY?.apply(media, el.frame, renderer.resolve(screen, device()));
  };

  const applyPosition = () => {
    renderer.applyContent(el.content, screen, device());
    renderer.applyInternalOffsets(el.form, el.privacy, screen, device());
  };

  const removeLoader = () => {
    if (!el.loader || el.loader.hidden) return;
    el.loader.classList.add('is-leaving');
    window.clearTimeout(loaderRemovalTimer);
    loaderRemovalTimer = window.setTimeout(() => {
      el.loader.hidden = true;
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
  };

  const revealConfiguredScreen = (mediaState) => {
    window.clearTimeout(mediaReadyTimer);
    el.unavailable.hidden = true;
    el.content.hidden = false;
    el.gate.setAttribute('aria-busy', 'false');
    document.documentElement.dataset.keyScreenMediaState = mediaState;
    document.documentElement.dataset.keyScreenState = 'ready';
    removeLoader();
  };

  const showEmergencyFallback = (error) => {
    window.clearTimeout(mediaReadyTimer);
    el.frame.replaceChildren();
    el.content.hidden = true;
    el.unavailable.hidden = false;
    el.gate.setAttribute('aria-busy', 'false');
    document.documentElement.dataset.keyScreenState = 'unavailable';
    console.error(
      '[CRONOX PANTALLA CLAVE] No se pudo hidratar la configuración pública; se muestra el fallback seguro.',
      error,
    );
    removeLoader();
  };

  const handleMediaFailure = (reason) => {
    window.clearTimeout(mediaReadyTimer);
    el.frame.replaceChildren();
    media = null;
    console.error(
      '[CRONOX PANTALLA CLAVE] La pantalla activa se cargó, pero el navegador no pudo mostrar su archivo multimedia.',
      reason,
    );
    revealConfiguredScreen(reason === 'timeout' ? 'timeout' : 'error');
  };

  const prepareMedia = (source, mediaType) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    media = document.createElement(mediaType === 'video' ? 'video' : 'img');
    media.setAttribute('aria-hidden', 'true');
    if (media.tagName === 'VIDEO') {
      media.autoplay = true;
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = 'auto';
    }

    const readyEvent = media.tagName === 'VIDEO' ? 'loadeddata' : 'load';
    media.addEventListener(
      readyEvent,
      () =>
        finish(() => {
          applyMedia();
          if (media.tagName === 'VIDEO') {
            media.play().catch(() => undefined);
          }
          revealConfiguredScreen('ready');
        }),
      { once: true },
    );
    media.addEventListener(
      'error',
      () => finish(() => handleMediaFailure('error')),
      { once: true },
    );
    el.frame.replaceChildren(media);
    media.src = source;
    if (media.tagName === 'VIDEO') media.load();

    mediaReadyTimer = window.setTimeout(
      () => finish(() => handleMediaFailure('timeout')),
      MEDIA_READY_TIMEOUT_MS,
    );
  };

  const render = (value) => {
    screen = value;
    applyViewport();
    const source = safeUrl(screen.media?.source);
    const mediaType = screen.media?.mediaType;
    el.shade.style.opacity = String(number(screen.overlayStrength, 0, 90, 25) / 100);
    el.content.style.setProperty('--key-text', screen.textColor || '#fff');
    el.content.dataset.inputStyle = screen.inputStyle;
    el.content.dataset.buttonStyle = screen.buttonStyle;
    el.title.textContent = screen.title;
    el.subtitle.textContent = screen.subtitle;
    el.email.placeholder = screen.placeholder;
    el.submit.textContent = screen.buttonText;
    el.privacy.textContent = screen.privacyLabel;
    el.privacy.href = privacyUrl(screen.privacyUrl);
    el.success.querySelector('h2').textContent = screen.successTitle;
    el.success.querySelector('p').textContent = screen.successMessage;
    applyPosition();

    if (!source || !['image', 'video'].includes(mediaType)) {
      console.error(
        '[CRONOX PANTALLA CLAVE] La configuración activa no contiene una URL multimedia pública válida. El formulario se muestra sobre el fondo seguro.',
      );
      el.frame.replaceChildren();
      revealConfiguredScreen('unavailable');
      return;
    }
    prepareMedia(source, mediaType);
  };

  const load = async () => {
    try {
      const endpoint = `${base}/api/key-screen`;
      const response = await fetch(endpoint, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`La API pública respondió HTTP ${response.status}.`);
      const payload = await response.json();
      if (!payload.enabled || !payload.screen) {
        console.error(
          '[CRONOX PANTALLA CLAVE] El servidor mostró la puerta, pero la API pública no devolvió una pantalla activa.',
          { enabled: payload.enabled, hasScreen: Boolean(payload.screen), endpoint },
        );
        location.replace('/');
        return;
      }
      render(payload.screen);
    } catch (error) {
      showEmergencyFallback(error);
    }
  };

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!el.email.checkValidity()) {
      el.email.reportValidity();
      return;
    }
    el.submit.disabled = true;
    el.message.textContent = '';
    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(await window.CRONOX_API.getCsrfHeaders()),
      };
      const response = await fetch(`${base}/api/key-screen/preregister`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ email: el.email.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? 'Demasiados intentos. Espera un minuto.'
            : Array.isArray(payload.message)
              ? payload.message.join(' ')
              : typeof payload.message === 'string'
                ? payload.message
                : 'No se pudo completar el preregistro.',
        );
      }
      el.form.hidden = true;
      el.success.hidden = false;
      el.success.focus();
    } catch (error) {
      el.message.textContent = error.message;
      el.submit.disabled = false;
    }
  });

  addEventListener('resize', () => {
    applyViewport();
    applyMedia();
    if (screen) applyPosition();
  }, { passive: true });
  load();
})();
