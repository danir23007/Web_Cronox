(() => {
  const stage = document.querySelector(".accreditation-stage");
  const frame = stage?.querySelector(".accreditation-book-frame");
  const book = frame?.querySelector(".accreditation-book");
  if (!stage || !frame || !book) return;

  // The book, artwork, text and interactive areas share this one design plane.
  const design = getComputedStyle(book);
  const width = Number(design.getPropertyValue("--accreditation-design-width"));
  const ratio = Number(design.getPropertyValue("--accreditation-design-ratio"));
  if (!(width > 0 && ratio > 0)) return;
  const height = width / ratio;
  let scheduled = 0;
  let previous = 0;
  const fitIdentity = () => {
    const top = book.querySelector(".accreditation-top");
    const identity = top?.querySelector(".accreditation-identity");
    const content = top?.closest(".accreditation-page-content");
    const promo = content?.querySelector(".accreditation-promo");
    if (!identity || !promo || !top.clientWidth) return;
    identity.style.width = `${top.clientWidth}px`;
    const naturalHeight = Math.max(
      identity.offsetHeight,
      identity.scrollHeight,
    );
    const page = content.closest(".accreditation-page");
    const pageStyle = getComputedStyle(page);
    const reserved = Array.from(content.children)
      .filter((child) => child !== top)
      .reduce((total, child) => {
        const style = getComputedStyle(child);
        return style.display === "none"
          ? total
          : total +
              child.offsetHeight +
              parseFloat(style.marginTop) +
              parseFloat(style.marginBottom);
      }, 0);
    const availableHeight =
      page.clientHeight -
      parseFloat(pageStyle.paddingTop) -
      parseFloat(pageStyle.paddingBottom) -
      reserved -
      24;
    if (!(naturalHeight > 0 && availableHeight > 0)) return;
    // Exceptional content: fit the WHOLE identity group in base coordinates.
    // This factor depends on data/font metrics, never on the viewport or the
    // book's transform. Normal names retain the original design at scale 1.
    const contentScale = Math.min(1, availableHeight / naturalHeight);
    identity.style.setProperty(
      "--accreditation-identity-scale",
      String(contentScale),
    );
    top.style.height = `${naturalHeight * contentScale}px`;
  };
  const layout = () => {
    scheduled = 0;
    const availableWidth = stage.clientWidth;
    if (!availableWidth || book.hidden) return; // inactive tabs/loading
    fitIdentity();
    const style = getComputedStyle(stage);
    const header =
      document.querySelector(".topbar")?.getBoundingClientRect().height || 0;
    const availableHeight =
      window.innerHeight -
      header -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom) -
      24;
    const scale = Math.min(
      1,
      availableWidth / width,
      availableHeight > 0 ? availableHeight / height : Infinity,
    );
    if (scale === previous) return;
    previous = scale;
    frame.style.width = `${width * scale}px`;
    frame.style.height = `${height * scale}px`;
    book.style.setProperty("--accreditation-scale", String(scale));
  };
  const schedule = () => {
    if (!scheduled) scheduled = requestAnimationFrame(layout);
  };
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  observer?.observe(stage);
  const header = document.querySelector(".topbar");
  if (header) observer?.observe(header);
  const contentObserver = new MutationObserver(schedule);
  contentObserver.observe(book, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.addEventListener("pageshow", schedule);
  for (const image of book.querySelectorAll("img"))
    image.addEventListener("load", schedule);
  document.fonts?.ready.then(schedule);
  document.fonts?.addEventListener("loadingdone", schedule);
  // Use the layout viewport, not visualViewport: native pinch zoom remains free
  // to magnify the entire composition without this fitter cancelling the zoom.
  window.CRONOX_ACCREDITATION_LAYOUT = Object.freeze({
    refresh() {
      if (scheduled) cancelAnimationFrame(scheduled);
      // Revealing the base plane can temporarily create a page scrollbar.
      // Resolve that width change before the first paint using the same fit.
      for (let pass = 0; pass < 4; pass++) {
        const available = stage.clientWidth;
        layout();
        if (available === stage.clientWidth) break;
      }
    },
  });
  schedule();
})();
