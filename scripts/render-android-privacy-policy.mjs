import { readFileSync } from 'node:fs';

const source = new URL('../docs/android/PRIVACY-POLICY.md', import.meta.url);
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const contact = 'TullLabs@outlook.com';
const content = readFileSync(source, 'utf8').trim().split(/\r?\n\s*\r?\n/).map((block) => {
  const heading = /^(#{1,2}) ([^\r\n]+)$/.exec(block);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
  }
  const text = escapeHtml(block.replace(/\r?\n/g, ' '));
  return `<p>${text.replaceAll(contact, `<a href="mailto:${contact}">${contact}</a>`)}</p>`;
}).join('\n');

process.stdout.write(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Espresso Dial-In Android privacy policy</title>
<style>
  body { font: 1rem/1.65 system-ui, sans-serif; color: #211b16; background: #faf7f2; margin: 0; }
  main { max-width: 70ch; margin: auto; padding: 1.5rem; overflow-wrap: anywhere; }
  h1, h2 { line-height: 1.2; }
  h2 { margin-top: 2rem; }
  a { color: #734420; }
</style>
<main>
${content}
</main>
</html>
`);
