// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry:   ['src/server.ts', 'scripts/*.ts'],
  format:  ['esm'],
  target:  'node20',
  outDir:  'dist',
  clean:   true,
  sourcemap: true,
});