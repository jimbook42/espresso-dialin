import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.vitest.js', 'scripts/pressure-replay/**/*.vitest.js', 'scripts/needle-reader/**/*.vitest.js'],
  },
});
