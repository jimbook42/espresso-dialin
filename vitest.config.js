import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsxInject: `import React from 'react'`,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.vitest.js', 'scripts/pressure-replay/**/*.vitest.js', 'scripts/needle-reader/**/*.vitest.js'],
  },
});
