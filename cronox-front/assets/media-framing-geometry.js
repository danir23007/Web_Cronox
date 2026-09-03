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
    const zoom = clamp(input.zoom, 1, 3, 1);
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
      fit,
      focalX,
      focalY,
      zoom,
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

  const api = Object.freeze({
    version: 1,
    calculate,
    apply,
    clear,
    focalFromDrag,
  });
  globalScope.CRONOX_MEDIA_GEOMETRY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
