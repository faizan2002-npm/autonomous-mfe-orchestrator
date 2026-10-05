import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const PORT = 5002;
// Where this remote is served from: VITE_MFE_ORDER_URL, else the Vercel production domain, else local dev.
const PUBLIC_URL = (
  process.env.VITE_MFE_ORDER_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:${PORT}`)
).replace(/\/$/, '');

export default defineConfig({
  envDir: new URL('../..', import.meta.url).pathname,
  // Absolute base so the host can load this remote's chunks cross-origin.
  base: `${PUBLIC_URL}/`,
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'mfe_order',
      filename: 'remoteEntry.js',
      exposes: { './OrderCard': './src/OrderCard.tsx' },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
      dts: false,
    }),
  ],
  server: { port: PORT, strictPort: true, origin: `http://localhost:${PORT}`, cors: true },
  preview: { port: PORT, strictPort: true, cors: true },
  build: { target: 'esnext' },
});
