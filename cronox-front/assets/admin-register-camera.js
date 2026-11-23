(() => {
  let session = 0,
    stream,
    readerScript, frameTimer, activeVideo;
  function stop() {
    session++;
    clearTimeout(frameTimer);
    if (activeVideo) { activeVideo.pause(); activeVideo.srcObject = null; }
    activeVideo = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  async function decoder(format) {
    try {
      if (
        (await window.BarcodeDetector?.getSupportedFormats())?.includes(format)
      ) {
        const native = new BarcodeDetector({ formats: [format] });
        return async (video) => {
          const result = (await native.detect(video))[0];
          if (!result) return;
          const points = result.cornerPoints;
          const box = result.boundingBox;
          const center = points?.length ? {
            x: points.reduce((n, p) => n + p.x, 0) / points.length / video.videoWidth,
            y: points.reduce((n, p) => n + p.y, 0) / points.length / video.videoHeight,
          } : box ? {
            x: (box.x + box.width / 2) / video.videoWidth,
            y: (box.y + box.height / 2) / video.videoHeight,
          } : undefined;
          return { value: result.rawValue, center };
        };
      }
    } catch {
      /* Fall through to the packaged decoder. */
    }
    if (!window.CRONOX_QR_READER && !readerScript) {
      readerScript = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/assets/qr-reader.js?v=3";
        script.onload = resolve;
        script.onerror = () => {
          readerScript = null;
          reject(Error("No se pudo cargar el lector."));
        };
        document.head.append(script);
      });
    }
    await readerScript;
    const reader = await window.CRONOX_QR_READER.createReader(
      format === "qr_code" ? "QRCode" : "Code128",
    );
    const canvas = document.createElement("canvas");
    return async (video) => {
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas
        .getContext("2d", { willReadFrequently: true })
        .drawImage(video, 0, 0, canvas.width, canvas.height);
      if (!reader.decodeResultFromCanvas) return { value: await reader.decodeFromCanvas(canvas) };
      const result = await reader.decodeResultFromCanvas(canvas);
      if (!result) return;
      const points = Object.values(result.position || {});
      return { value: result.text, center: points.length ? {
        x: points.reduce((n, p) => n + p.x, 0) / points.length / canvas.width,
        y: points.reduce((n, p) => n + p.y, 0) / points.length / canvas.height,
      } : undefined };
    };
  }
  async function start({ video, devices, format, deviceId, onRead, onError }) {
    stop();
    const active = session;
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw Error(
          "La cámara requiere HTTPS o localhost y un navegador compatible.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: "environment" } },
      });
      if (active !== session) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      activeVideo = video;
      video.srcObject = media;
      await video.play();
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
      if (active !== session) return;
      devices.replaceChildren(
        ...cameras.map(
          (d, i) => new Option(d.label || "Cámara " + (i + 1), d.deviceId),
        ),
      );
      devices.value = media.getVideoTracks()[0].getSettings().deviceId || "";
      const read = await decoder(format);
      // Track each visible code independently; alternating codes must not bypass suppression.
      const visible = new Map();
      async function frame() {
        if (active !== session) return;
        try {
          const detection = await read(video);
          const value = detection?.value;
          if (active !== session) return;
          for (const [code, absent] of visible) {
            if (code === value) visible.set(code, 0);
            else if (absent >= 4) visible.delete(code);
            else visible.set(code, absent + 1);
          }
          if (value && !visible.has(value)) {
            visible.set(value, 0);
            // The ticket serializes mutations; keep decoding while network work is pending.
            Promise.resolve(onRead(value, detection)).catch((err) => {
              if (active === session) onError(err.message);
            });
          }
          if (active === session) frameTimer = setTimeout(frame, 150);
        } catch (err) {
          if (active === session) {
            stop();
            onError(err.message);
          }
        }
      }
      frame();
    } catch (err) {
      if (active !== session) return;
      stop();
      onError(
        err.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Puedes introducir el código o usar un lector externo."
          : "Cámara no disponible. " + err.message,
      );
    }
  }
  window.CRONOX_REGISTER_CAMERA = { start, stop };
  window.addEventListener("pagehide", stop);
})();
