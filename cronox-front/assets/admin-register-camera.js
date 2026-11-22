(() => {
  let session = 0,
    stream,
    readerScript;
  function stop() {
    session++;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  async function decoder(format) {
    try {
      if (
        (await window.BarcodeDetector?.getSupportedFormats())?.includes(format)
      ) {
        const native = new BarcodeDetector({ formats: [format] });
        return async (video) => (await native.detect(video))[0]?.rawValue;
      }
    } catch {
      /* Fall through to the packaged decoder. */
    }
    if (!window.CRONOX_QR_READER && !readerScript) {
      readerScript = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/assets/qr-reader.js?v=2";
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
      return reader.decodeFromCanvas(canvas);
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
      let last,
        absent = 0;
      async function frame() {
        if (active !== session) return;
        try {
          const value = await read(video);
          if (active !== session) return;
          if (value) {
            absent = 0;
            if (last !== value) {
              last = value;
              await onRead(value);
            }
          } else if (++absent >= 5) last = null;
          if (active === session) setTimeout(frame, 150);
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
