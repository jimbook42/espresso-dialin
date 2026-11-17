import { spawnSync } from 'node:child_process';

const env = { ...process.env, VITE_ENABLE_PRESSURE_LAB: 'true', VITE_ENABLE_SCALE: 'true', VITE_SCALE_ALLOW_SIM: 'false', VITE_PRESSURE_ALLOW_SIM: 'false', VITE_PRESSURE_REPLAY: 'false' };
for (const args of [['scripts/copy-opencv-asset.mjs'], ['scripts/copy-needle-ort.mjs'], ['node_modules/vite/bin/vite.js', 'build', '--mode', 'android'], ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
