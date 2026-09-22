import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: webRoot,
  envDir: webRoot,
  // Relative asset URLs so the static build can be hosted under any path.
  base: './',
  plugins: [react()],
  server: {
    // The app imports packages/core and packages/solana straight from source.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
});
