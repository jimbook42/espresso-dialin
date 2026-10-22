const MAX_BODY = 200 * 1024;
const CHUNK_CHARS = 3500;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function logPayload(body) {
  const line = JSON.stringify(body);
  if (body.type === 'all' && line.length > CHUNK_CHARS) {
    const sendId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const n = Math.ceil(line.length / CHUNK_CHARS);
    for (let i = 0; i < n; i++) {
      const data = line.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
      console.log(`PLABEL_CHUNK ${sendId} ${i + 1}/${n} ${data}`);
    }
    return;
  }
  console.log(`PLABEL ${line}`);
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    res.statusCode = 413;
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  logPayload(body);
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
