import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');

const VITE_PREVIEW = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

export async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Server not ready at ${url}`);
}

/**
 * Start vite preview; returns kill() that tears down the whole process group.
 */
export function startPreviewServer(port) {
  const url = `http://127.0.0.1:${port}/`;
  const child = spawn(
    process.execPath,
    [VITE_PREVIEW, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
      detached: true,
    }
  );
  child.unref();

  let stopped = false;

  const kill = async () => {
    if (stopped || !child.pid) return;
    stopped = true;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // already exited
      }
    }
    await delay(400);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
    }
  };

  const onSignal = () => {
    void kill().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { url, kill };
}
