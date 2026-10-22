import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FRAMES_SRC = '/workspace/pl-state/label-frames';
const OUT = '/workspace/pl-state/label-deploy';

function main() {
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  const style = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(FRAMES_SRC, 'manifest.json'), 'utf8'),
  );

  const frameMap = {};
  for (const ent of fs.readdirSync(FRAMES_SRC)) {
    if (!ent.endsWith('.jpg')) continue;
    const b64 = fs.readFileSync(path.join(FRAMES_SRC, ent)).toString('base64');
    frameMap[ent] = `data:image/jpeg;base64,${b64}`;
  }

  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(
    '<link rel="stylesheet" href="style.css" />',
    `<style>\n${style}\n</style>`,
  );
  const boot = `<script>window.PLABEL_CONFIG=${JSON.stringify({
    hosted: true,
    storageKey: 'plabel-labels-v1',
  })};window.PLABEL_MANIFEST=${JSON.stringify(manifest)};</script>`;
  html = html.replace(
    '<script src="app.js"></script>',
    `${boot}\n  <script src="frames.js"></script>\n  <script src="app.js"></script>`,
  );
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  fs.copyFileSync(path.join(ROOT, 'app.js'), path.join(OUT, 'app.js'));

  const frameKeys = Object.keys(frameMap).sort();
  const parts = frameKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(frameMap[k])}`);
  fs.writeFileSync(
    path.join(OUT, 'frames.js'),
    `window.PLABEL_FRAMES={${parts.join(',')}};\n`,
  );

  fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'vercel', 'api', 'log.js'),
    path.join(OUT, 'api', 'log.js'),
  );

  const vercelJson = {
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(OUT, 'vercel.json'), `${JSON.stringify(vercelJson, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"module"}\n');

  const files = [];
  function walk(d, prefix = '') {
    for (const ent of fs.readdirSync(d).sort()) {
      const rel = prefix ? `${prefix}/${ent}` : ent;
      const full = path.join(d, ent);
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else files.push(rel);
    }
  }
  walk(OUT);
  console.log(`Deploy folder: ${OUT}\n  ${files.join('\n  ')}`);
}

main();
