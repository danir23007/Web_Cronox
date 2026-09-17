(function (globalScope) {
  "use strict";

  const EPSILON = 0.5;
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : fallback;
  };

  const calculate = (input = {}) => {
    const frameWidth = Number(input.frameWidth);
    const frameHeight = Number(input.frameHeight);
    const mediaWidth = Number(input.mediaWidth);
    const mediaHeight = Number(input.mediaHeight);
    if (
      !Number.isFinite(frameWidth) ||
      !Number.isFinite(frameHeight) ||
      !Number.isFinite(mediaWidth) ||
      !Number.isFinite(mediaHeight) ||
      frameWidth <= 0 ||
      frameHeight <= 0 ||
      mediaWidth <= 0 ||
      mediaHeight <= 0
    ) {
      return {
        valid: false,
        movementX: false,
        movementY: false,
        travelX: 0,
        travelY: 0,
      };
    }

    const fit =
      String(input.fit || "COVER").toUpperCase() === "CONTAIN"
        ? "CONTAIN"
        : "COVER";
    const focalX = clamp(input.focalX, 0, 100, 50);
    const focalY = clamp(input.focalY, 0, 100, 50);
    const minZoom = clamp(input.minZoom, 0.05, 3, 1);
    const maxZoom = clamp(input.maxZoom, minZoom, 10, 3);
    const zoom = clamp(input.zoom, minZoom, maxZoom, Math.max(1, minZoom));
    const widthScale = frameWidth / mediaWidth;
    const heightScale = frameHeight / mediaHeight;
    const baseScale =
      fit === "CONTAIN"
        ? Math.min(widthScale, heightScale)
        : Math.max(widthScale, heightScale);
    const scale = baseScale * zoom;
    const renderedWidth = mediaWidth * scale;
    const renderedHeight = mediaHeight * scale;
    const rangeX = frameWidth - renderedWidth;
    const rangeY = frameHeight - renderedHeight;
    const translateX = rangeX * (focalX / 100);
    const translateY = rangeY * (focalY / 100);

    return {
      valid: true,
      frameWidth,
      frameHeight,
      mediaWidth,
      mediaHeight,
      fit,
      focalX,
      focalY,
      zoom,
      minZoom,
      maxZoom,
      baseScale,
      scale,
      renderedWidth,
      renderedHeight,
      translateX,
      translateY,
      rangeX,
      rangeY,
      travelX: Math.abs(rangeX),
      travelY: Math.abs(rangeY),
      movementX: Math.abs(rangeX) > EPSILON,
      movementY: Math.abs(rangeY) > EPSILON,
    };
  };

  const intrinsicSize = (element) => ({
    width: Number(element?.videoWidth || element?.naturalWidth || 0),
    height: Number(element?.videoHeight || element?.naturalHeight || 0),
  });

  const frameSize = (element) => {
    const rect = element?.getBoundingClientRect?.();
    return {
      width: Number(rect?.width || element?.clientWidth || 0),
      height: Number(rect?.height || element?.clientHeight || 0),
    };
  };

  const clear = (element, frameElement) => {
    if (element?.style) {
      [
        "width",
        "height",
        "max-width",
        "max-height",
        "left",
        "top",
        "right",
        "bottom",
        "inset",
        "object-fit",
        "object-position",
        "transform",
        "transform-origin",
      ].forEach((property) => element.style.removeProperty(property));
    }
    if (frameElement?.dataset) {
      frameElement.dataset.mediaMovementX = "false";
      frameElement.dataset.mediaMovementY = "false";
      frameElement.dataset.mediaGeometry = "pending";
    }
  };

  const apply = (element, frameElement, framing, dimensions = {}) => {
    const measuredFrame = frameSize(frameElement);
    const measuredMedia = intrinsicSize(element);
    const geometry = calculate({
      frameWidth: dimensions.frameWidth || measuredFrame.width,
      frameHeight: dimensions.frameHeight || measuredFrame.height,
      mediaWidth: dimensions.mediaWidth || measuredMedia.width,
      mediaHeight: dimensions.mediaHeight || measuredMedia.height,
      focalX: framing?.focalX,
      focalY: framing?.focalY,
      zoom: framing?.zoom,
      minZoom: framing?.minZoom,
      maxZoom: framing?.maxZoom,
      fit: framing?.fit,
    });

    if (!geometry.valid) {
      clear(element, frameElement);
      return geometry;
    }

    const style = element.style;
    style.position = "absolute";
    style.inset = "auto";
    style.left = "0px";
    style.top = "0px";
    style.right = "auto";
    style.bottom = "auto";
    style.width = `${geometry.renderedWidth}px`;
    style.height = `${geometry.renderedHeight}px`;
    style.maxWidth = "none";
    style.maxHeight = "none";
    style.objectFit = "fill";
    style.objectPosition = "50% 50%";
    style.transformOrigin = "0 0";
    style.transform = `translate3d(${geometry.translateX}px, ${geometry.translateY}px, 0)`;
    frameElement.dataset.mediaMovementX = String(geometry.movementX);
    frameElement.dataset.mediaMovementY = String(geometry.movementY);
    frameElement.dataset.mediaGeometry = "ready";
    return geometry;
  };

  const focalFromDrag = (geometry, start, deltaX, deltaY) => ({
    focalX: geometry?.movementX
      ? clamp(
          Number(start.focalX) + (Number(deltaX) / geometry.rangeX) * 100,
          0,
          100,
          Number(start.focalX),
        )
      : Number(start.focalX),
    focalY: geometry?.movementY
      ? clamp(
          Number(start.focalY) + (Number(deltaY) / geometry.rangeY) * 100,
          0,
          100,
          Number(start.focalY),
        )
      : Number(start.focalY),
  });

  const zoomAtPoint = (geometry, nextZoom, pointX, pointY) => {
    if (!geometry?.valid) {
      return {
        zoom: clamp(nextZoom, 1, 3, 1),
        focalX: Number(geometry?.focalX ?? 50),
        focalY: Number(geometry?.focalY ?? 50),
      };
    }
    const zoom = clamp(
      nextZoom,
      Number(geometry.minZoom ?? 1),
      Number(geometry.maxZoom ?? 3),
      geometry.zoom,
    );
    const mediaX = (Number(pointX) - geometry.translateX) / geometry.scale;
    const mediaY = (Number(pointY) - geometry.translateY) / geometry.scale;
    const scale = geometry.baseScale * zoom;
    const rangeX = geometry.frameWidth - geometry.mediaWidth * scale;
    const rangeY = geometry.frameHeight - geometry.mediaHeight * scale;
    const translateX = Number(pointX) - mediaX * scale;
    const translateY = Number(pointY) - mediaY * scale;
    return {
      zoom,
      focalX:
        Math.abs(rangeX) > EPSILON
          ? clamp((translateX / rangeX) * 100, 0, 100, geometry.focalX)
          : geometry.focalX,
      focalY:
        Math.abs(rangeY) > EPSILON
          ? clamp((translateY / rangeY) * 100, 0, 100, geometry.focalY)
          : geometry.focalY,
    };
  };

  const heroTextViewport = (value, device = "desktop") => {
    const legacy = value || {};
    const selected = value?.[device];
    if (selected && typeof selected === "object") return selected;
    const mobile = device === "mobile";
    return {
      x: mobile ? legacy.mobileX : legacy.x,
      y: mobile ? legacy.mobileY : legacy.y,
      align: legacy.align,
      color: legacy.color,
      fontSize: mobile ? legacy.mobileFontSize : legacy.fontSize,
      fontWeight: legacy.fontWeight,
      letterSpacing: legacy.letterSpacing,
      uppercase: legacy.uppercase,
      maxWidth: legacy.maxWidth,
    };
  };

  const heroTextStyle = (value, device = "desktop", visualScale = 1) => {
    if (typeof device === "boolean") device = device ? "mobile" : "desktop";
    const selected = heroTextViewport(value, device);
    const scale = clamp(visualScale, 0.05, 4, 1);
    const maxWidth = clamp(selected?.maxWidth, 10, 100, 90);
    return {
      position: "absolute",
      width: "max-content",
      maxWidth: `${maxWidth}%`,
      textAlign: String(selected?.align || "CENTER").toLowerCase(),
      color: String(selected?.color || "#ffffff"),
      fontSize: `${clamp(selected?.fontSize, 12, 120, device === "mobile" ? 30 : 42) * scale}px`,
      fontWeight: String(selected?.fontWeight || 800),
      letterSpacing: `${clamp(selected?.letterSpacing, -2, 20, 1.5) * scale}px`,
      transform: "none",
      margin: "0",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    };
  };

  const calculateHeroTextPosition = (input = {}) => {
    const viewportWidth = Math.max(0, Number(input.viewportWidth) || 0);
    const viewportHeight = Math.max(0, Number(input.viewportHeight) || 0);
    const textWidth = Math.min(viewportWidth, Math.max(0, Number(input.textWidth) || 0));
    const textHeight = Math.min(viewportHeight, Math.max(0, Number(input.textHeight) || 0));
    const x = clamp(input.x, 0, 100, 50);
    const y = clamp(input.y, 0, 100, 50);
    return {
      x,
      y,
      left: ((viewportWidth - textWidth) * x) / 100,
      top: ((viewportHeight - textHeight) * y) / 100,
      viewportWidth,
      viewportHeight,
      textWidth,
      textHeight,
    };
  };

  const heroTextCoordinates = (left, top, viewportWidth, viewportHeight, textWidth, textHeight) => ({
    x: viewportWidth > textWidth
      ? clamp((Number(left) / (viewportWidth - textWidth)) * 100, 0, 100, 50)
      : 0,
    y: viewportHeight > textHeight
      ? clamp((Number(top) / (viewportHeight - textHeight)) * 100, 0, 100, 50)
      : 0,
  });

  const applyHeroText = (element, viewportElement, value, device = "desktop", options = {}) => {
    if (!element?.style || !viewportElement) return null;
    const selected = heroTextViewport(value, device);
    Object.assign(element.style, heroTextStyle(value, device, options.visualScale));
    const viewportRect = viewportElement.getBoundingClientRect?.() || {};
    const textRect = element.getBoundingClientRect?.() || {};
    const position = calculateHeroTextPosition({
      viewportWidth: options.viewportWidth || viewportRect.width || viewportElement.clientWidth,
      viewportHeight: options.viewportHeight || viewportRect.height || viewportElement.clientHeight,
      textWidth: options.textWidth || textRect.width || element.offsetWidth,
      textHeight: options.textHeight || textRect.height || element.offsetHeight,
      x: selected?.x,
      y: selected?.y,
    });
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    return position;
  };

  const api = Object.freeze({
    version: 4,
    calculate,
    apply,
    clear,
    focalFromDrag,
    zoomAtPoint,
    heroTextViewport,
    heroTextStyle,
    calculateHeroTextPosition,
    heroTextCoordinates,
    applyHeroText,
  });
  globalScope.CRONOX_MEDIA_GEOMETRY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
