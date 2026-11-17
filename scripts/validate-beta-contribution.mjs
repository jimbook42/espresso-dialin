import { open } from 'node:fs/promises';
import { MAX_CONTRIBUTION_BYTES, validateContribution } from '../src/beta/contribution.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/validate-beta-contribution.mjs FILE [FILE ...]');
  process.exitCode = 1;
}

for (const [index, filename] of files.entries()) {
  let handle;
  try {
    handle = await open(filename);
    const { size } = await handle.stat();
    if (size > MAX_CONTRIBUTION_BYTES) throw new Error('Size limit exceeded');
    const bytes = Buffer.alloc(size + 1);
    const { bytesRead } = await handle.read(bytes, { length: size + 1 });
    if (bytesRead !== size) throw new Error('File changed during read');
    const { records, distinctFingerprints } = await validateContribution(JSON.parse(bytes.subarray(0, size).toString('utf8')));
    console.log(`File ${index + 1}: PASS, ${records} records and ${distinctFingerprints} distinct fingerprints`);
  } catch {
    console.error(`File ${index + 1}: FAIL. Check file access, size, format and record integrity.`);
    process.exitCode = 1;
  } finally {
    await handle?.close();
  }
}
