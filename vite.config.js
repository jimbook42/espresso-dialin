import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import process from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

function pressureLabBuildId() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const pressureLabBuild = pressureLabBuildId();
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const vercelSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
const appCommitSha = vercelSha ? vercelSha.slice(0, 7) : (pressureLabBuild === 'unknown' ? '' : pressureLabBuild);

const pwaManifest = {
  name: 'Espresso Dial-In',
  short_name: 'EspressoDial',
  start_url: '/',
  display: 'standalone',
  background_color: '#1a1714',
  theme_color: '#1a1714',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// `npm run dev:flair-lab` uses HTTPS so a phone on the bench can open the front camera.
export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_PRESSURE_LAB_BUILD': JSON.stringify(pressureLabBuild),
    'import.meta.env.VITE_ENABLE_PRESSURE_LAB': JSON.stringify(
      mode === 'flairlab' || process.env.VITE_ENABLE_PRESSURE_LAB === 'true' ? 'true' : 'false'
    ),
    'import.meta.env.VITE_PRESSURE_REPLAY': JSON.stringify(
      process.env.VITE_PRESSURE_REPLAY === 'true' ? 'true' : 'false'
    ),
    'import.meta.env.VITE_ENABLE_SCALE': JSON.stringify(
      process.env.VITE_ENABLE_SCALE === 'false' ? 'false' : 'true'
    ),
    'import.meta.env.VITE_SCALE_ALLOW_SIM': JSON.stringify(
      process.env.VITE_SCALE_ALLOW_SIM === 'true' ? 'true' : 'false'
    ),
    'import.meta.env.VITE_PRESSURE_ALLOW_SIM': JSON.stringify(
      process.env.VITE_PRESSURE_ALLOW_SIM === 'true' ? 'true' : 'false'
    ),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(appCommitSha),
  },
  plugins: [
    react(),
    mode === 'flairlab' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.json',
      manifest: pwaManifest,
      injectManifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/flair-pressure-lab/opencv.js'],
      },
    }),
  ].filter(Boolean),
}));
