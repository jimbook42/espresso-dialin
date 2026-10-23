#!/usr/bin/env python3
"""Local review page for the Phase R1 pack.

Binds to 127.0.0.1 only. No tunnel. Frames stay under /workspace/pl-state/nr/review.
"""
from __future__ import annotations

import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REVIEW_DIR = Path("/workspace/pl-state/nr/review")
ANSWERS_PATH = REVIEW_DIR / "answers.json"
TOKEN_PATH = REVIEW_DIR / "token.txt"
HOST = "127.0.0.1"
PORT = 8765

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Needle review</title>
<style>
  body { margin: 0; font: 15px/1.4 sans-serif; background: #141414; color: #f2f2f2; }
  header { position: sticky; top: 0; background: #1d1d1d; padding: 12px 16px; border-bottom: 1px solid #333; }
  main { padding: 16px; display: grid; gap: 18px; }
  article { background: #1d1d1d; border: 1px solid #333; padding: 12px; max-width: 920px; }
  .stage { position: relative; display: inline-block; max-width: 100%; cursor: crosshair; }
  img, canvas { display: block; max-width: 100%; height: auto; }
  canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  button { margin-right: 8px; padding: 6px 12px; }
  .ok { outline: 2px solid #3dbb6a; }
  .fix { outline: 2px solid #e0b040; }
  .meta { color: #c8c8c8; margin: 8px 0; }
  .saved { color: #8d8; }
</style>
</head>
<body>
<header>
  <strong>Needle review</strong>
  <span id="progress"></span>
  <div>OK accepts the yellow tip. Click the true tip to correct it.</div>
</header>
<main id="list"></main>
<script>
const token = new URLSearchParams(location.search).get('token') || '';
const list = document.getElementById('list');
const progress = document.getElementById('progress');
let answers = {};

function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-Review-Token': token };
}

function drawUser(canvas, frame, tip) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!tip || frame.cx == null) return;
  ctx.strokeStyle = '#ff5a5a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(frame.cx, frame.cy);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}

function updateProgress() {
  const cards = document.querySelectorAll('article');
  const done = document.querySelectorAll('article.ok, article.fix').length;
  progress.textContent = ' ' + done + ' / ' + cards.length + ' answered';
}

async function save(frame, verdict, tip) {
  const body = { id: frame.id, verdict, tip: tip || null };
  const response = await fetch('/answer', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!response.ok) throw new Error('save failed');
  answers[frame.id] = body;
}

function mount(frame) {
  const card = document.createElement('article');
  card.dataset.id = frame.id;
  const stage = document.createElement('div');
  stage.className = 'stage';
  const img = document.createElement('img');
  img.src = frame.file + '?token=' + encodeURIComponent(token);
  img.alt = frame.id;
  const canvas = document.createElement('canvas');
  stage.append(img, canvas);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const bar = frame.bar == null ? 'no bar' : Number(frame.bar).toFixed(2) + ' bar';
  meta.textContent = frame.clip + '  t=' + frame.timeS + 's  frame ' + frame.frame
    + '  ' + bar + '  ' + (frame.keep ? 'KEEP' : 'DROP') + ' ' + frame.reason
    + (frame.uncertain ? ' uncertain' : '')
    + '  conf ' + (frame.confidence == null ? '—' : frame.confidence);
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'OK';
  const status = document.createElement('span');
  status.className = 'saved';
  ok.addEventListener('click', async () => {
    await save(frame, 'ok', null);
    card.classList.remove('fix');
    card.classList.add('ok');
    drawUser(canvas, frame, null);
    status.textContent = ' saved OK';
    updateProgress();
  });
  img.addEventListener('load', () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const prior = answers[frame.id];
    if (prior && prior.verdict === 'fix' && prior.tip) {
      card.classList.add('fix');
      drawUser(canvas, frame, prior.tip);
    } else if (prior && prior.verdict === 'ok') {
      card.classList.add('ok');
    }
    updateProgress();
  });
  stage.addEventListener('click', async (event) => {
    if (frame.cx == null) return;
    const rect = img.getBoundingClientRect();
    const x = (event.clientX - rect.left) * img.naturalWidth / rect.width;
    const y = (event.clientY - rect.top) * img.naturalHeight / rect.height;
    const tip = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    const angle = Math.atan2(tip.y - frame.cy, tip.x - frame.cx) * 180 / Math.PI;
    await save(frame, 'fix', { ...tip, angleDeg: Math.round(((angle % 360) + 360) % 360 * 10) / 10 });
    card.classList.remove('ok');
    card.classList.add('fix');
    drawUser(canvas, frame, tip);
    status.textContent = ' saved tip';
    updateProgress();
  });
  card.append(stage, meta, ok, status);
  list.append(card);
}

async function boot() {
  if (!token) {
    list.textContent = 'Open the URL printed by review_r1.py. It includes the token.';
    return;
  }
  const headers = { 'X-Review-Token': token };
  const manifest = await fetch('/manifest.json', { headers }).then((response) => {
    if (!response.ok) throw new Error('manifest');
    return response.json();
  });
  const saved = await fetch('/answers.json', { headers }).then((response) => response.json());
  answers = saved.frames || {};
  for (const frame of manifest.frames) mount(frame);
  updateProgress();
}
boot().catch((error) => { list.textContent = String(error); });
</script>
</body>
</html>
"""


def load_token() -> str:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    if TOKEN_PATH.exists():
        token = TOKEN_PATH.read_text().strip()
        if token:
            return token
    token = secrets.token_hex(16)
    TOKEN_PATH.write_text(token + "\n")
    return token


def load_answers() -> dict:
    if not ANSWERS_PATH.exists():
        return {"frames": {}}
    try:
        payload = json.loads(ANSWERS_PATH.read_text())
    except json.JSONDecodeError:
        payload = {"frames": {}}
    payload.setdefault("frames", {})
    return payload


def save_answers(payload: dict):
    tmp = ANSWERS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(ANSWERS_PATH)


class Handler(BaseHTTPRequestHandler):
    token = ""

    def log_message(self, fmt, *args):
        return

    def _authorized(self) -> bool:
        header = self.headers.get("X-Review-Token", "")
        query = parse_qs(urlparse(self.path).query)
        supplied = header or (query.get("token") or [""])[0]
        if len(supplied) != len(self.token):
            return False
        return secrets.compare_digest(supplied, self.token)

    def _send(self, code: int, body: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _reject(self):
        self._send(403, b"forbidden\n", "text/plain; charset=utf-8")

    def do_GET(self):
        if not self._authorized():
            self._reject()
            return
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            return
        if path == "/answers.json":
            self._send(200, json.dumps(load_answers()).encode(), "application/json")
            return
        if path == "/manifest.json":
            target = REVIEW_DIR / "manifest.json"
        elif path.startswith("/frames/"):
            target = (REVIEW_DIR / path.lstrip("/")).resolve()
            if REVIEW_DIR.resolve() not in target.parents:
                self._reject()
                return
        else:
            self._send(404, b"not found\n", "text/plain; charset=utf-8")
            return
        if not target.is_file():
            self._send(404, b"not found\n", "text/plain; charset=utf-8")
            return
        kind = "application/json" if target.suffix == ".json" else "image/jpeg"
        self._send(200, target.read_bytes(), kind)

    def do_POST(self):
        if urlparse(self.path).path != "/answer" or not self._authorized():
            self._reject()
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 20000:
            self._send(400, b"bad body\n", "text/plain; charset=utf-8")
            return
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._send(400, b"bad json\n", "text/plain; charset=utf-8")
            return
        frame_id = body.get("id")
        verdict = body.get("verdict")
        if not isinstance(frame_id, str) or verdict not in ("ok", "fix"):
            self._send(400, b"bad answer\n", "text/plain; charset=utf-8")
            return
        payload = load_answers()
        payload["frames"][frame_id] = {
            "verdict": verdict,
            "tip": body.get("tip"),
            "updatedAt": __import__("datetime").datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        }
        save_answers(payload)
        self._send(200, b'{"ok":true}\n', "application/json")


def main():
    token = load_token()
    Handler.token = token
    if not ANSWERS_PATH.exists():
        save_answers({"frames": {}})
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}/?token={token}", flush=True)
    print("bound to 127.0.0.1 only; no tunnel", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
