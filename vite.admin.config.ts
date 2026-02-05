import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'cronox-front/assets',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        api: resolve(__dirname, 'cronox-front/src/admin/api.ts'),
        'admin-user': resolve(__dirname, 'cronox-front/src/admin/admin-user.ts'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
