import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Solo `src/lib`: el resto de la app es React Native y no corre en Node.
// Ver el docstring de `src/lib/loadInput.ts` y el paso 5 del handoff.
export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    reporters: 'verbose',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});
