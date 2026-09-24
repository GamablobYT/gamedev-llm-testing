import { defineConfig } from 'vite';

export default defineConfig({
  base: '/gamedev-llm-testing/',
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
