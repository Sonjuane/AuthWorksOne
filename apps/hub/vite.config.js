// Hub UI build (Vue 3 + Tailwind v4): apps/hub/ui -> apps/hub/ui/dist, served by the Hub.
// `npm run hub:ui:dev` proxies API calls to a Hub on :3030.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  plugins: [vue(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '^/(ui-api|v1|connect|login|logout|callback)': 'http://localhost:3030' } },
});
