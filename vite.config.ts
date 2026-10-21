import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  test: {
    globals: true,
    // Threads start faster than forks on slow (e.g. WSL-mounted) filesystems.
    pool: 'threads',
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
