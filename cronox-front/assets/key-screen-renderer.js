(function (globalScope) {
  "use strict";

  const BREAKPOINT = 640;
  const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1920, height: 1080 }),
    mobile: Object.freeze({ width: 390, height: 844 }),
  });
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const deviceForWidth = (width) => Number(width) <= BREAKPOINT ? "mobile" : "desktop";
  const capitalized = (device) => device === "mobile" ? "mobile" : "desktop";

  const resolve = (screen, requestedDevice) => {
    const device = capitalized(requestedDevice);
    const desktop = device === "desktop";
    const legacyHorizontal = screen.horizontalAlign || "CENTER";
    const legacyVertical = screen.verticalAlign || "CENTER";
    const legacyOffsetX = clamp(screen.offsetX, -400, 400, 0);
    const legacyOffsetY = clamp(screen.offsetY, -400, 400, 0);
    return {
      device,
      focalX: clamp(desktop ? screen.desktopFocalX : screen.mobileFocalX ?? screen.desktopFocalX, 0, 100, 50),
      focalY: clamp(desktop ? screen.desktopFocalY : screen.mobileFocalY ?? screen.desktopFocalY, 0, 100, 50),
      zoom: clamp(desktop ? screen.desktopZoom : screen.mobileZoom ?? screen.desktopZoom, 1, 3, 1),
      fit: String(desktop ? screen.desktopFit : screen.mobileFit || screen.desktopFit).toUpperCase() === "CONTAIN" ? "CONTAIN" : "COVER",
      horizontalAlign: screen[`${device}HorizontalAlign`] || legacyHorizontal,
      verticalAlign: screen[`${device}VerticalAlign`] || legacyVertical,
      offsetX: clamp(screen[`${device}OffsetX`] ?? legacyOffsetX, -400, 400, legacyOffsetX),
      offsetY: clamp(screen[`${device}OffsetY`] ?? legacyOffsetY, -400, 400, legacyOffsetY),
      formOffsetX: clamp(screen[`${device}FormOffsetX`], -400, 400, 0),
      formOffsetY: clamp(screen[`${device}FormOffsetY`], -400, 400, 0),
      privacyOffsetX: clamp(screen[`${device}PrivacyOffsetX`], -400, 400, 0),
      privacyOffsetY: clamp(screen[`${device}PrivacyOffsetY`], -400, 400, 0),
    };
  };

  const applyViewport = (root, width, height) => {
    root.style.setProperty("--key-vw", `${Number(width) / 100}px`);
    root.style.setProperty("--key-vh", `${Number(height) / 100}px`);
    root.dataset.keyDevice = deviceForWidth(width);
  };

  const applyContent = (element, screen, device) => {
    const config = resolve(screen, device);
    const horizontal = { LEFT: "start", CENTER: "center", RIGHT: "end" }[config.horizontalAlign] || "center";
    const vertical = { TOP: "start", CENTER: "center", BOTTOM: "end" }[config.verticalAlign] || "center";
    element.dataset.horizontal = horizontal;
    element.dataset.vertical = vertical;
    element.style.setProperty("--key-offset-x", `${config.offsetX}px`);
    element.style.setProperty("--key-offset-y", `${config.offsetY}px`);
    return config;
  };

  const applyInternalOffsets = (form, privacy, screen, device) => {
    const config = resolve(screen, device);
    form?.style.setProperty("--key-form-offset-x", `${config.formOffsetX}px`);
    form?.style.setProperty("--key-form-offset-y", `${config.formOffsetY}px`);
    privacy?.style.setProperty("--key-privacy-offset-x", `${config.privacyOffsetX}px`);
    privacy?.style.setProperty("--key-privacy-offset-y", `${config.privacyOffsetY}px`);
    return config;
  };

  const clampContentOffsets = (input) => {
    const width = Math.max(0, Number(input.viewportWidth) || 0);
    const height = Math.max(0, Number(input.viewportHeight) || 0);
    const contentWidth = Math.min(width, Math.max(0, Number(input.contentWidth) || 0));
    const contentHeight = Math.min(height, Math.max(0, Number(input.contentHeight) || 0));
    const baseX = input.horizontalAlign === "LEFT" ? 0 : input.horizontalAlign === "RIGHT" ? width - contentWidth : (width - contentWidth) / 2;
    const baseY = input.verticalAlign === "TOP" ? 0 : input.verticalAlign === "BOTTOM" ? height - contentHeight : (height - contentHeight) / 2;
    return {
      offsetX: Math.round(clamp(input.offsetX, Math.max(-400, -baseX), Math.min(400, width - contentWidth - baseX), 0)),
      offsetY: Math.round(clamp(input.offsetY, Math.max(-400, -baseY), Math.min(400, height - contentHeight - baseY), 0)),
    };
  };

  const api = Object.freeze({
    version: 1,
    BREAKPOINT,
    VIEWPORTS,
    deviceForWidth,
    resolve,
    applyViewport,
    applyContent,
    applyInternalOffsets,
    clampContentOffsets,
  });
  globalScope.CRONOX_KEY_SCREEN_RENDERER = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
