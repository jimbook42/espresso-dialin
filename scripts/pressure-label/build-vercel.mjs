import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FRAMES_SRC = '/workspace/pl-state/label-frames';
const OUT = '/workspace/pl-state/label-deploy';

const STATIC = ['index.html', 'app.js', 'style.css'];

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  for (const name of STATIC) {
    copyFile(path.join(ROOT, name), path.join(OUT, name));
  }

  const configJs = `window.PLABEL_CONFIG = {
  hosted: true,
  manifestPath: 'manifest.json',
  framesPath: 'frames',
  storageKey: 'plabel-labels-v1',
};
`;
  fs.writeFileSync(path.join(OUT, 'config.js'), configJs);

  let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  html = html.replace(
    '<script src="app.js"></script>',
    '<script src="config.js"></script>\n  <script src="app.js"></script>',
  );
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  copyFile(
    path.join(FRAMES_SRC, 'manifest.json'),
    path.join(OUT, 'manifest.json'),
  );

  const framesOut = path.join(OUT, 'frames');
  fs.mkdirSync(framesOut, { recursive: true });
  for (const ent of fs.readdirSync(FRAMES_SRC)) {
    if (!ent.endsWith('.jpg')) continue;
    copyFile(path.join(FRAMES_SRC, ent), path.join(framesOut, ent));
  }

  copyFile(
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

  console.log(`Deploy folder: ${OUT} (${fs.readdirSync(framesOut).length} frames)`);
}

main();
