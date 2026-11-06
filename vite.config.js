import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import fs from 'fs';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const r2Endpoint = env.R2_ENDPOINT_URL || '';
  const r2Bucket = env.R2_BUCKET_NAME || '';
  const modelBase =
    mode === 'production' && r2Endpoint && r2Bucket
      ? `${r2Endpoint}/${r2Bucket}`
      : '';
  return {
    plugins: [
      react(),
      wyw(),
      {
        name: 'copy-maps-decals',
        closeBundle() {
          const src = path.resolve('maps');
          const dest = path.resolve('dist/maps');
          if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_MODEL_BASE': JSON.stringify(modelBase),
    },
    server: {
      port: 3000,
      open: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});