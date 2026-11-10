import { readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
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
const fullShaPattern = /^[a-f0-9]{40}$/i;

// A local build has commit provenance only when its tracked inputs match HEAD.
function diagnosticsBuildSha() {
  if (fullShaPattern.test(vercelSha)) return vercelSha;
  try {
    if (execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim()) return null;
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function verifyReleaseBuild(env) {
  if (env.VITE_ENABLE_PRESSURE_LAB !== 'true' || env.VITE_ENABLE_SCALE !== 'true') {
    throw new Error('Release preflight requires camera pressure and scale support.');
  }
  if ([env.VITE_PRESSURE_ALLOW_SIM, env.VITE_SCALE_ALLOW_SIM, env.VITE_PRESSURE_REPLAY].includes('true')) {
    throw new Error('Release preflight requires pressure simulation, scale simulation and replay to be disabled.');
  }

  const expectedSha = (process.env.RELEASE_EXPECTED_SHA || '').trim();
  let head;
  const gitOptions = {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
  } catch {
    // Vercel source uploads can omit .git. The release caller must supply the approved SHA.
  }
  if (head && execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], gitOptions).trim()) {
    throw new Error('Release preflight requires clean tracked build inputs.');
  }
  if (!fullShaPattern.test(env.VITE_APP_FULL_COMMIT_SHA || '')) {
    throw new Error('Release preflight requires a full embedded Git SHA.');
  }
  if ((!head && !fullShaPattern.test(expectedSha))
      || (head && env.VITE_APP_FULL_COMMIT_SHA !== head)
      || (expectedSha && env.VITE_APP_FULL_COMMIT_SHA !== expectedSha)) {
    throw new Error('Release preflight requires the embedded Git SHA to match the source checkout and any approved SHA.');
  }
}

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
    'import.meta.env.VITE_APP_FULL_COMMIT_SHA': JSON.stringify(diagnosticsBuildSha()),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(appCommitSha),
  },
  plugins: [
    react(),
    mode === 'flairlab' ? basicSsl() : null,
    mode === 'release' ? {
      name: 'release-preflight',
      configResolved(config) {
        const keys = [
          'VITE_ENABLE_PRESSURE_LAB', 'VITE_ENABLE_SCALE', 'VITE_PRESSURE_ALLOW_SIM',
          'VITE_SCALE_ALLOW_SIM', 'VITE_PRESSURE_REPLAY', 'VITE_APP_FULL_COMMIT_SHA',
        ];
        verifyReleaseBuild(Object.fromEntries(keys.map((key) => [
          key, JSON.parse(config.define[`import.meta.env.${key}`] ?? 'null'),
        ])));
      },
    } : null,
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
