# Recovering labels from Vercel logs

Hosted labelling does not write to disk on Vercel. Labels reach you only through **runtime logs**.

## What gets logged

Each tap and each **Send labels** action `POST`s to `/api/log`. The serverless function prints one line per event:

- `PLABEL {"type":"tap","frameId":"f001","record":{...}}`
- `PLABEL {"type":"all","labels":{"frames":{...}}}`

Large **Send labels** payloads are split:

- `PLABEL_CHUNK <sendId> 1/3 <json fragment>`
- `PLABEL_CHUNK <sendId> 2/3 …`

## Fetch logs

1. Deploy the folder from `node scripts/pressure-label/build-vercel.mjs` (`/workspace/pl-state/label-deploy/`).
2. In the Vercel dashboard, open the deployment → **Logs** (or use `vercel logs`).
3. Export or copy log lines that contain `PLABEL` or `PLABEL_CHUNK`.

## Merge into `labels.json`

```bash
node scripts/pressure-label/merge-logs.mjs < vercel-log-export.txt
```

Writes `/workspace/pl-state/labels.json`:

- The **latest** `{ type: "all" }` event replaces the full document.
- **Tap** events are merged by `updatedAt` (newer wins per `frameId`).

Taps alone are enough if the user never pressed **Send labels**; **Send labels** is the reliable full snapshot.
