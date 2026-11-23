import { prepareZXingModule, purgeZXingModule, readBarcodes } from 'zxing-wasm/reader';

// Resolve from this local script, never the package's default CDN location.
const scriptUrl = (document.currentScript as HTMLScriptElement | null)?.src || new URL('/assets/qr-reader.js', location.href).href;
const wasmUrl = new URL('./zxing_reader.wasm', scriptUrl).href;
let ready: Promise<unknown> | undefined;

export async function createReader(format: 'QRCode' | 'Code128' = 'QRCode') {
  if (!ready) ready = prepareZXingModule({
    fireImmediately: true,
    overrides: { locateFile: () => wasmUrl },
  }).catch(error => { ready = undefined; purgeZXingModule(); throw error; });
  await ready;
  async function decodeResultFromCanvas(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas no disponible');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readBarcodes(image, { formats: [format], tryHarder: true, maxNumberOfSymbols: 1 });
    return results.find(result => result.isValid);
  }
  return {
    decodeResultFromCanvas,
    async decodeFromCanvas(canvas: HTMLCanvasElement): Promise<string | undefined> {
      return (await decodeResultFromCanvas(canvas))?.text;
    },
  };
}
