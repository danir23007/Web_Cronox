import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Locally packaged fallback for browsers without a QR-capable BarcodeDetector.
export default defineConfig({
  plugins: [{
    name: 'qr-reader-licenses',
    generateBundle() {
      const source = ['zxing-wasm'].map(name =>
        `${name}\n${readFileSync(resolve(__dirname, 'node_modules', name, 'LICENSE'), 'utf8')}`,
      ).join('\n\n') + '\n\nZXing-C++\n' + readFileSync(resolve(__dirname, 'cronox-front/src/admin/licenses/ZXing-CPP-LICENSE.txt'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'qr-reader-LICENSE.txt', source });
      this.emitFile({ type: 'asset', fileName: 'zxing_reader.wasm', source: readFileSync(resolve(__dirname, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')) });
    },
  }],
  build: {
    target: 'es2020',
    outDir: 'cronox-front/assets',
    emptyOutDir: false,
    rollupOptions: { output: { banner: '/*! QR reader: zxing-wasm (ZXing-C++). License: qr-reader-LICENSE.txt */' } },
    lib: {
      entry: resolve(__dirname, 'cronox-front/src/admin/qr-reader.ts'),
      name: 'CRONOX_QR_READER',
      formats: ['iife'],
      fileName: () => 'qr-reader.js',
    },
  },
});
