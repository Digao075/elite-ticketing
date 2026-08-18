import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The repository keeps a single .env at its root. Vite otherwise reads only
  // apps/web/.env, so VITE_API_URL was never loaded and the client silently
  // fell back to its hardcoded localhost default.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
});
