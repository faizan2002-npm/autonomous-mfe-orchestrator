import path from 'node:path';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const PORT = 5000;
const ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, 'VITE_');
  const remote = (name: string, fallback: string) => ({
    type: 'module' as const,
    name,
    entry: env[`VITE_${name.toUpperCase()}_ENTRY`] || fallback,
    entryGlobalName: name,
    shareScope: 'default',
  });
  return {
    envDir: ROOT,
    plugins: [
      react(),
      tailwindcss(),
      federation({
        name: 'mfe_shell',
        // Remote URLs are runtime configuration: each micro-frontend deploys independently.
        remotes: {
          mfe_user: remote('mfe_user', 'http://localhost:5001/remoteEntry.js'),
          mfe_order: remote('mfe_order', 'http://localhost:5002/remoteEntry.js'),
        },
        shared: {
          react: { singleton: true },
          'react-dom': { singleton: true },
        },
        dts: false,
      }),
    ],
    server: { port: PORT, strictPort: true },
    preview: { port: PORT, strictPort: true },
    build: { target: 'esnext' },
  };
});
