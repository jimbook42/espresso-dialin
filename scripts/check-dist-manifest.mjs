import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const distIndex = 'dist/index.html';
execSync('npm run build', { stdio: 'inherit' });
if (!existsSync(distIndex)) {
  throw new Error(`Build did not produce ${distIndex}`);
}

const html = readFileSync(distIndex, 'utf8');
const matches = html.match(/rel="manifest"/g) ?? [];
assert.equal(
  matches.length,
  1,
  `Expected exactly one manifest link in ${distIndex}, found ${matches.length}`
);
console.log('dist manifest link check passed.');
