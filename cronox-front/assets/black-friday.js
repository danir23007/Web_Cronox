(function () {
  'use strict';
  const preview = window.parent !== window && new URLSearchParams(location.search).has('bf-preview');
  if (!document.querySelector('.topbar') || document.body.classList.contains('cronox-admin') || document.body.dataset.registrationSource === 'event') return;
  const root = document.documentElement;
  const hero = document.body.classList.contains('page-home') && !root.classList.contains('category-page') ? document.getElementById('hero') : null;
  let config, timer, raf, large, banner, compact = false, previewCompact = false, forcedNow;
  let serverEpoch = 0, monotonicEpoch = 0, lastPhase = '', resizeObserver, refreshTimer, loading = false;
  const now = () => (forcedNow !== undefined ? forcedNow : serverEpoch) + performance.now() - monotonicEpoch;
  const phase = (settings, time) => {
    if (settings?.enabled !== true) return 'disabled';
    const start = Date.parse(settings.startsAt), end = Date.parse(settings.endsAt);
    if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'invalid';
    if (['title', 'bannerText', 'eventText'].some(key => typeof settings[key] !== 'string' || !settings[key].trim())) return 'invalid';
    return time >= end ? 'ended' : time >= start ? 'event' : 'before';
  };
  function countdown(target, time) {
    const seconds = Math.max(0, Math.ceil((target - time) / 1000));
    return [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  }
  function create(format) {
    const element = document.createElement('section');
    element.className = `bf-${format}`;
    element.setAttribute('aria-label', 'Campaña Black Friday');
    const message = document.createElement(format === 'hero' ? 'h2' : 'div');
    message.className = 'bf-message';
    const track = document.createElement('span');
    track.className = 'bf-track';
    const text = document.createElement('span');
    text.className = 'bf-text';
    if (format === 'banner') {
      const run = document.createElement('span');
      run.className = 'bf-run';
      run.append(text);
      track.append(run);
    } else track.append(text);
    message.append(track);
    const clock = document.createElement('div');
    clock.className = 'bf-clock';
    // The changing digits are decorative. A stable, explicit date provides the accessible equivalent.
    clock.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'bf-clock-label';
    const units = document.createElement('span');
    units.className = 'bf-units';
    ['DÍAS', 'HORAS', 'MINUTOS', 'SEGUNDOS'].forEach(unit => {
      const cell = document.createElement('span');
      const value = document.createElement('b');
      value.textContent = '00';
      const caption = document.createElement('small');
      caption.textContent = unit;
      cell.append(value, caption);
      units.append(cell);
    });
    clock.append(label, units);
    const description = document.createElement('span');
    description.className = 'bf-sr';
    element.append(message, clock, description);
    return element;
  }
  function offset() {
    root.style.setProperty('--bf-offset', `${compact && banner ? banner.getBoundingClientRect().height : 0}px`);
  }
  function fillMarquee() {
    if (!banner) return;
    const track = banner.querySelector('.bf-track'), run = track.firstElementChild;
    const text = run.querySelector('.bf-text');
    run.replaceChildren(text);
    while (track.children.length > 1) track.lastElementChild.remove();
    const unitWidth = text.getBoundingClientRect().width;
    const count = unitWidth ? Math.max(1, Math.ceil(banner.querySelector('.bf-message').clientWidth / unitWidth)) : 1;
    for (let index = 1; index < count; index++) {
      const copy = text.cloneNode(true);
      copy.className = 'bf-copy';
      copy.setAttribute('aria-hidden', 'true');
      run.append(copy);
    }
    const duplicate = run.cloneNode(true);
    duplicate.classList.add('bf-copy');
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.querySelectorAll('.bf-text').forEach(node => { node.className = 'bf-copy'; });
    track.append(duplicate);
    track.style.setProperty('--bf-duration', `${Math.max(8, run.getBoundingClientRect().width / 48)}s`);
  }
  function showCompact(value) {
    compact = value;
    root.classList.toggle('bf-compact', compact);
    if (large) { large.classList.toggle('bf-hidden', compact); large.setAttribute('aria-hidden', String(compact)); }
    banner.classList.toggle('bf-hidden', !compact);
    banner.setAttribute('aria-hidden', String(!compact));
    offset();
  }
  function scroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!banner) return;
      if (phase(config, now()) === 'event') return showCompact(true);
      if (preview) return showCompact(previewCompact);
      if (!hero) return showCompact(true);
      const rect = hero.getBoundingClientRect();
      const distance = -rect.top;
      const threshold = Math.min(160, Math.max(64, rect.height * 0.16));
      showCompact(compact ? distance > threshold - 28 : distance > threshold);
    });
  }
  function teardown() {
    clearInterval(timer); timer = 0;
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('resize', scroll);
    resizeObserver?.disconnect();
    large?.remove(); banner?.remove(); large = banner = null;
    root.classList.remove('bf-active', 'bf-compact', 'bf-interior');
    root.style.removeProperty('--bf-offset');
    hero?.classList.remove('bf-host');
    lastPhase = '';
  }
  function tick() {
    const time = now(), current = phase(config, time);
    if (!['before', 'event'].includes(current)) { teardown(); return; }
    if (current === 'event' && lastPhase !== 'event') {
      large?.remove(); large = null;
      hero?.classList.remove('bf-host');
      showCompact(true);
    }
    const target = Date.parse(current === 'event' ? config.endsAt : config.startsAt);
    [large, banner].filter(Boolean).forEach(element => {
      if (lastPhase !== current) {
        const message = element === large ? config.title : config.bannerText;
        element.querySelector('.bf-text').textContent = message;
        element.querySelector('.bf-clock-label').textContent = current === 'event' ? 'TERMINA EN' : 'EMPIEZA EN';
        const date = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'short' }).format(new Date(target));
        element.querySelector('.bf-sr').textContent = `${message}. ${current === 'event' ? 'Finaliza' : 'Comienza'} el ${date} (Europe/Madrid).`;
      }
      const digits = element.querySelectorAll('.bf-units b');
      countdown(target, time).forEach((value, index) => {
        const text = String(value).padStart(2, '0');
        if (digits[index].textContent !== text) digits[index].textContent = text;
      });
    });
    if (lastPhase !== current) fillMarquee();
    lastPhase = current;
  }
  function mount(settings, time, isCompact) {
    teardown(); config = settings;
    forcedNow = preview ? time : undefined;
    serverEpoch = Date.parse(settings.serverTime);
    if (!Number.isFinite(serverEpoch)) serverEpoch = Date.now();
    monotonicEpoch = performance.now();
    if (!['before', 'event'].includes(phase(config, now()))) return;
    root.classList.add('bf-active');
    root.classList.toggle('bf-interior', !hero);
    banner = create('banner');
    banner.style.color = /^#[a-f\d]{6}$/i.test(config.textColor) ? config.textColor : '#ffffff';
    banner.style.backgroundColor = /^#[a-f\d]{6}$/i.test(config.backgroundColor) ? config.backgroundColor : '#111111';
    document.body.append(banner);
    if (hero && phase(config, now()) === 'before') { hero.classList.add('bf-host'); large = create('hero'); hero.append(large); }
    previewCompact = Boolean(isCompact);
    tick();
    if (phase(config, now()) === 'event' || !hero) showCompact(true);
    else if (preview) showCompact(previewCompact);
    else {
      const rect = hero.getBoundingClientRect();
      showCompact(-rect.top > Math.min(160, Math.max(64, rect.height * 0.16)));
    }
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', scroll, { passive: true });
    resizeObserver = new ResizeObserver(() => { offset(); fillMarquee(); });
    resizeObserver.observe(banner);
    resizeObserver.observe(banner.querySelector('.bf-message'));
    document.fonts?.ready.then(fillMarquee);
    scroll();
    timer = setInterval(tick, 250);
  }
  const base = () => String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(`${base()}/api/black-friday`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Configuration unavailable');
      const settings = await response.json();
      const unchanged = config && Object.keys({ ...config, ...settings }).every(key => key === 'serverTime' || config[key] === settings[key]);
      if (unchanged && banner) {
        const epoch = Date.parse(settings.serverTime);
        serverEpoch = Number.isFinite(epoch) ? epoch : Date.now();
        monotonicEpoch = performance.now();
        tick();
      } else mount(settings);
    } catch { teardown(); }
    finally { loading = false; }
  }
  const visibility = () => {
    if (document.visibilityState !== 'visible') return;
    if (config && banner) tick();
    if (!preview) load();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', () => { teardown(); clearInterval(refreshTimer); });
  const refresh = () => {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
  };
  window.addEventListener('pageshow', event => { if (event.persisted && !preview) { load(); refresh(); } });
  window.addEventListener('storage', event => { if (!preview && event.key === 'cronox:bf:revision') load(); });
  if (preview) {
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'cronox:bf-preview') return;
      try {
        if (!/^\/admin(?:\.html)?\/?$/.test(parent.location.pathname)) return;
        window.scrollTo(0, 0);
        mount({ ...event.data.settings, enabled: true }, event.data.now, event.data.compact);
      } catch { teardown(); }
    });
    parent.postMessage({ type: 'cronox:bf-ready' }, location.origin);
  } else { load(); refresh(); }
})();
