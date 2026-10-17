/* Fit the same composition to its own document viewport (profile or isolated
   sample iframe). Renderer geometry, interaction and animation remain owned by
   the shared renderer. The parent administrator window is never measured. */
(function () {
  const shell = document.querySelector('[data-metacrilatos-fit]');
  const section = shell?.querySelector('[data-profile-section="accreditation"]');
  const member = section?.querySelector('[data-metacrilatos-member]');
  const footer = document.querySelector('body > .footer');
  if (!shell || !section || !member || !footer) return;

  const desktop = window.matchMedia('(min-width: 760px)');
  const layoutClass = document.body.classList.contains('metacrilatos-preview')
    ? 'metacrilatos-preview-desktop' : 'metacrilatos-profile-desktop';
  const properties = ['--meta-fit-width', '--meta-fit-height', '--meta-fit-scale', '--meta-back-margin'];
  const baseWidth = 690;
  const horizontalMargin = 24;
  const bottomGap = 12;
  let frame = 0;
  let listening = false;
  let enabled = false;
  let resizeObserver;
  let mutationObserver;

  const eligible = () => desktop.matches && section.isConnected
    && section.classList.contains('is-active')
    && !section.classList.contains('is-loading') && !section.hidden
    && section.dataset.accreditationRenderer === 'metacrilatos-v1'
    && !member.hidden && Boolean(section.querySelector('.metacrilatos-host'));

  function clearLayout() {
    enabled = false;
    document.body.classList.remove(layoutClass);
    properties.forEach(property => shell.style.removeProperty(property));
  }

  function setNumber(property, value, unit = '') {
    // Ignore subpixel noise so a resize caused by our own layout settles after
    // one follow-up measurement instead of keeping a frame loop alive.
    const rounded = Math.round(value * 10000) / 10000;
    const previous = Number.parseFloat(shell.style.getPropertyValue(property));
    if (!Number.isFinite(previous) || Math.abs(previous - rounded) > 0.0001) {
      shell.style.setProperty(property, `${rounded}${unit}`);
    }
  }

  function fit() {
    frame = 0;
    if (!listening) return;
    if (!eligible()) {
      if (enabled) clearLayout();
      return;
    }
    if (!enabled) {
      enabled = true;
      setNumber('--meta-fit-scale', 1);
      setNumber('--meta-fit-width', baseWidth, 'px');
      document.body.classList.add(layoutClass);
    }

    // CSS zoom participates in layout and keeps text/QR rasterisation at the
    // displayed size. Divide its measured height by the current exterior zoom;
    // no internal renderer transform or its responsive scale is overwritten.
    const zoom = Number.parseFloat(getComputedStyle(section).zoom) || 1;
    const bottomSpacing = window.CRONOX_METACRILATOS_PRESENTATION?.bottomSpacing(section, zoom);
    if (Number.isFinite(bottomSpacing)) setNumber('--meta-back-margin', bottomSpacing, 'px');
    const naturalHeight = section.getBoundingClientRect().height / zoom;
    if (!Number.isFinite(naturalHeight) || naturalHeight <= 0) return;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const shellTop = shell.getBoundingClientRect().top + window.scrollY;
    const footerStyle = getComputedStyle(footer);
    const footerHeight = footer.getBoundingClientRect().height
      + (Number.parseFloat(footerStyle.marginTop) || 0)
      + (Number.parseFloat(footerStyle.marginBottom) || 0);
    const availableWidth = Math.max(0, viewportWidth - horizontalMargin * 2);
    const availableHeight = Math.max(0, viewportHeight - shellTop - footerHeight - bottomGap);

    // Existing text/control sizes are the readability floor. Short windows or
    // browser zoom therefore scroll vertically instead of shrinking controls.
    const referenceHeight = window.CRONOX_METACRILATOS_PRESENTATION?.scaleReferenceHeight(section, zoom, naturalHeight) || naturalHeight;
    const scale = Math.max(1, Math.min(availableWidth / baseWidth, availableHeight / referenceHeight));
    setNumber('--meta-fit-scale', scale);
    setNumber('--meta-fit-width', Math.max(baseWidth * scale, availableWidth), 'px');
    setNumber('--meta-fit-height', Math.max(availableHeight, naturalHeight * scale), 'px');
  }

  function schedule() {
    if (listening && !frame) frame = window.requestAnimationFrame(fit);
  }

  function start() {
    if (listening) return;
    listening = true;
    resizeObserver = new ResizeObserver(schedule);
    // The section changes size when actual history, long privileges, fonts or
    // the existing promotion notice change. Chrome sizes affect the free space.
    [section, footer, document.querySelector('.topbar'),
      document.querySelector('.profile-page > .store-heading'),
      document.querySelector('.profile-tabs'), document.getElementById('profileMessage')]
      .filter(Boolean).forEach(element => resizeObserver.observe(element));
    mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(section, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'data-accreditation-renderer'],
      childList: true,
    });
    mutationObserver.observe(member, {
      attributes: true, attributeFilter: ['hidden', 'data-circle-level'],
      childList: true, characterData: true, subtree: true,
    });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    desktop.addEventListener('change', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    schedule();
  }

  function stop() {
    listening = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    desktop.removeEventListener('change', schedule);
    document.fonts?.removeEventListener('loadingdone', schedule);
    clearLayout();
  }

  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  start();
})();
