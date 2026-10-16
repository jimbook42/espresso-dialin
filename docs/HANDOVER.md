# HANDOVER: Espresso Dial-In

This file is self-contained: Part A is the shared process (same in every repo) and Part B is this project. No secrets are included.

# Part B: Espresso Dial-In

## Snapshot (17 Oct 2026, ~1:30am NZ)
- **What:** an espresso grind-recommendation PWA. It covers grinders (Sette, Sunbeam, Niche, Breville presets), beans, shots, the brew guide, a BLE scale (Timemore, behind a flag) and a camera-based pressure gauge reader (Flair "pressure lab", behind a flag).
- **Repo:** `jimbook42/espresso-dialin` (public).
  - **Production base: `main`.** Last release **v4.10.3** @ `6b83ee4` (PR #13), 15 Oct.
  - GitHub's *default* branch is still the stale `master` (`d6a0c83` has an older `vercel.json` with only `master` + `qa/*`). **`main`** gains matching deploy limits via ticket **6.36** (`vercel.json`: `main`, `master`, `qa/*` only).
- **Live:** https://espresso-dialin-puce.vercel.app. Vercel project `espresso-dialin` (team jimbook).
- **Pressure lab (stacked, unmerged):** chain **6.29 → 6.35** on feature branches; target 9/10 reading accuracy before ship.
  - **6.33** @ `73b3b18` (zero/needle/worker; 0% confidently-wrong on replay).
  - **6.34** @ `55a4b69` (rotation/determinism/startup/blur).
  - **6.35** @ `2d211f2` (glare experiments; pre-shot hint only; glare rework deferred).
  - Preview **`qa/6-35-pressure-preview`** @ `84cd36b` (visible lab link for hosted QA; not production).
  - Lab must stay **feature-flagged OFF** in production (`VITE_ENABLE_PRESSURE_LAB`).
- **In flight (docs):** **6.36** on `cursor/6-36-docs` — roadmap, this handover, `vercel.json` on `main`.
- **Rollback points:**
  - previous prod deploys: v4.10.2 `515a6f5`, v4.10.1 `c678be4`
  - tag `automation-start/2026-10-13/espresso-dialin` → `def29ff` (v4.3)

## Docs
- In the repo: `README.md`, `docs/PROJECT_NOTES.md` (stack, commands, gotchas), `docs/roadmap-niche.md` (Niche + future work), `docs/HANDOVER.md` (this file), `THIRD_PARTY_NOTICES.md` (opencv.js, Apache-2.0).
- The PM's durable files hold the roadmap (`roadmap-niche.md`), tickets 5.x and 6.x, `research/timemore-ble.md`, and Isaac's real shot data CSV. Copy these across with the PM store.

## Stack and commands
- React 19 + Vite 8, Tailwind 4, vite-plugin-pwa, Dexie/IndexedDB `EspressoDialDB` **schema v17** (no bump without an explicit ticket). OpenCV.js for the pressure lab.
- `npm ci`, `npm run lint`, `npm test` (node harness; doesn't include vitest), `npx vitest run`, `npm run build`, Playwright smoke scripts `npm run test:playwright-*`.
- Pressure replay: `npm run replay:pressure` over clips in `FLAIR_REPLAY_DIR` (default `/workspace/flair-replay/720`). The PM scores each run as found %, within ±0.5 bar, time to first reading, confidently-wrong %, and 4× CPU throttle latency, plus a privacy check.
- On the box, always: `/workspace/bin/box-test-slot <test>` and `--build` for builds.

## Project-specific rules
- **Isaac's facts:** his bean profile, prompts and roasting/grinder facts are treated as fact.
- **Grinder IDs:** grinder identity strings are stable persisted IDs; never rename them without a migration.
- **Pressure lab:**
  - flag OFF in prod
  - no clip names, coordinates or expected values in non-test src
  - **0% confidently-wrong readings is a safety requirement**
- **Scale:**
  - use measured yield, with the timer starting after preinfusion
  - flow rate and curve are recorded but are not a grind input
  - users without a scale keep full manual use
- **Model:** grok-4.7-high for the pressure-lab / computer-vision tickets; xhigh only with Isaac's OK.
- **Limits:** max 2 repairs and 8 tickets per session. Keep chaining approved roadmap tickets without asking.

## Open issues / next
- Merge stacked pressure-lab branches in order; then Isaac/PM decision on promote vs more CV work (glare, 4× speed, real-phone + held-back clip tests, beta label).
- Queued **v4.11.0 walkthrough polish** (Isaac rulings; blind-walkthrough screenshots under `/workspace/qa-reports/dialin-blind-2/`). Details in `docs/roadmap-niche.md`.
- BLE scale branch `feat/ble-scale` (Web Bluetooth, simulated scale on Preview only).
- **Multi-tab safety follow-up:** audit non-`patchGlobalSettings` settings writes (e.g. CSV import).
- **Nits (still open):** NaN warnings in the bean form; **"1 shots"** plural. (v4.10.3 / **6.28** fixed compact advisories, blank roaster parentheses, shot notes on Dial/History.)
- Niche roadmap item **4** DEFERRED (no hardware); item **5** full browser QA pending.

## QA checklist (Dial-In QA)
1. Local production build of the exact SHA (footer version), served outside the lock.
2. Run the `QA:` items, then a smoke test: add a bean, log a shot, get a recommendation, history, settings, and each grinder preset. Check a mobile width of 412px.
3. Data safety: existing Dexie data loads unchanged and there's no schema bump.
4. Pressure lab (when in scope): the replay harness through box-test-slot, then the scoring table. Any confidently-wrong reading = FAIL.
5. Give a verdict line plus findings, to Dial-In PM only.


## Appendix B: Bot instruction texts (sanitised, verbatim as of 16 Oct 2026)
Some of these instructions are older than Part A. Where they conflict, Part A wins: Cursor CLI, not cloud agents, and the model policy in A4.

### Dial-In PM
````text
PM for Espresso Dial-in (repo jimbook42/espresso-dialin, working branch refactor/device-architecture; GitHub is the source of truth). Runs roadmap tickets through Composer cloud agents per the pm-ticket-loop skill, verifies diffs and deploys, and routes QA to Dial-in QA.
- Limits: max 2 repairs per ticket, max 8 tickets per session. Keep chaining approved roadmap tickets automatically without asking; stop only at a hard gate (design/product/PO decisions included), a block, or the cap.
- QA is tiered by risk per the skill; you are Isaac's only contact, QA bots report to you.
- Hard gates unchanged: no merge/promote, schema/migration/data changes, auth/privacy changes, or model escalation without Isaac's OK in chat.
````

### Dial-In QA
````text
You test Espresso Dial-in, a live espresso recipe app. Isaac is the owner. You work for Dial-In PM: it sends your test requests and you report ONLY to Dial-In PM, never to Isaac directly (Isaac's rule, 16 Oct 2026). You never change code.

ONE JOB: when Dial-In PM sends a QA request (standing OK from Isaac, no need to ask him), take that brief as the brief and as fact for the bean profile, the shots to pull, and what “good” means. Then use the repo to learn how each grinder and the brew guide actually calculate, and check the app against that. Do not treat the brief as permission to invent behaviour the repo does not have.

WHAT TO TEST: the exact SHA/build Dial-In PM names, normally a local production build on the box (vite preview on localhost) under the shared test lock `flock -w 1200 /tmp/box-test.lock timeout 10m <cmd>`, only if MemAvailable >= 3 GB. Use the hosted production app (https://espresso-dialin-puce.vercel.app/) or a qa/* preview only when the PM asks.
CODE, the only source of truth: GitHub jimbook42/espresso-dialin, at the branch/SHA the PM names (master if none). https://github.com/jimbook42/espresso-dialin
Do not look in Google Drive. GitHub has the repo.

Pressure lab: test it only if Dial-In PM's request asks for it; otherwise skip it and say so.

CHECKS, unless the brief narrows them:
1. Every grinder the repo defines. For each, read its settings and step size from the code, then use those controls in the app. Flag a control that does not match the repo.
2. Brew guide adjustment accuracy. Read the formula in the repo. Change one input at a time in the app. Compare the shown advice to the number the code should produce. Show the arithmetic.
3. Faux shots from the bean profile in the brief. Pull the shots it names. Judge taste targets only against the brief and the repo's own science. If you use an outside coffee fact, label it as outside the repo and do not treat it as a bug by itself.

READ-ONLY. No file edits, commits, PRs, issues, comments, or Vercel changes.

HONESTY: every finding is Confirmed | Likely | Possible | Ambiguous. Confirmed means you saw it in the app or read it in a file this session. Cite the file path for any expected number. If you did not read it, say unverified. Never invent a grinder, a formula, or a screen.

REPORT (short, to Dial-In PM): SHA tested, bean profile used, grinders checked, brew-guide checks with expected vs shown, shot results, mismatches with file paths, what you skipped.

ANTI-JOBS: no patches, no redesign, no tickets, no messaging any bot except Dial-In PM, and never message Isaac directly; if something needs Isaac, tell Dial-In PM.

VOICE: short NZ plain talk. Facts first.

WAKE: when Dial-In PM sends a request (or Isaac messages you directly). If the request lacks a bean profile or brief, ask Dial-In PM, not Isaac.

SILENT CHAT: Isaac does not read this chat. When work came from Dial-In PM or a background task, finish by messaging Dial-In PM only and end your turn WITHOUT any message to Isaac (no status line, no 'I sent it to the PM'). Write in this chat only when Isaac himself messaged you this turn.
````


---

# Part A: Shared AI project-management process

Isaac's process for running a software project with AI bots. It's the same for Hui, Dial-In and IRC. This section is all you need to rebuild it on another bot service. The project-specific details are in Part B.

> No secrets are in this file. Wherever a credential is needed, the file says so as **[credential: ...]**. Store it in the new service's secret store or as an environment variable, never in a repo or ticket.

## A1. Roles

| Role | Who | Does | Never does |
|---|---|---|---|
| Owner | Isaac (NZ, Pacific/Auckland) | Sets the roadmap, makes product/design decisions, approves gates | Doesn't read the code |
| Chief of Staff (optional) | A bot | Shared rules, building bots, escalations, recovery, picking active projects (max 2) | Project work |
| PM | One bot per project | Plans, writes tickets, launches Cursor, checks the diff/CI/deploy, routes QA, keeps state, merges when allowed. **Isaac's only contact for the project** | **Never writes or edits code**, and never writes to the repo itself except a direct squash-merge (A8) |
| Coder | Cursor CLI (`agent`) on the build machine | Every repo write: code, tests, docs, commits, pushes, tags, version bumps, Vercel promotes/rollbacks | QA sign-off |
| QA | One bot per project | Tests the exact SHA (local production build, or `qa/*` preview) against the ticket's QA block | **Reports only to its PM, never to Isaac.** Its chat with Isaac stays silent. A standing OK covers its routine actions |

Style: short, plain NZ English. Tell Isaac things only at a gate, a block, a release, or at session end.

## A2. Ticket loop, end to end
1. **Load state:** read the state file and the latest handover. Check GitHub for the base branch, working branch and HEAD SHA. If GitHub disagrees with state, stop and report.
2. **Check approval:** confirm the next ticket is approved in the roadmap. If that's unclear, ask Isaac.
3. **Write the ticket** in a file. It covers the goal, scope (exact files and areas), non-goals, acceptance criteria, tests, QA tier, version bump, and the box rules (test lock, no `pkill -f`, PID-only kills, no watch mode). It ends with: commit, push the ticket branch, and report the SHA, tests and files, plus a `QA:` block of up to 3 lines. No secrets go in ticket text.
4. **Launch the Cursor CLI** in the background (A3). Log the PID, start time, model and session id.
5. **Verify** from GitHub, not from Cursor's report. Get the pushed SHA and read the diff. Check scope, unrelated files, acceptance criteria, and risky files (migrations, auth, schema, env).
6. **CI** must be green for that SHA. If CI is red, send it straight back to Cursor; never start QA on red.
7. **QA by tier** (A6). Send the QA bot the URL or local build, the SHA and the items. Use its labelled verdict. A skipped check is NOT TESTED, never PASS.
8. **Fail:** resume the same Cursor session with the evidence. Max 2 repairs, then BLOCKED and tell Isaac. A stall relaunch or timeout resume doesn't count as a repair.
9. **Pass:** open or ready the PR, then merge (A8), check the production deploy and the footer version/SHA, and send Isaac a one-line release note. Update state, append to the log, write the handover, and move on to the next approved ticket (max 8 per session).

**Stop and ask Isaac** at any of these: roadmap or priority change, a product/design/formula/architecture decision, a migration or data change, an auth/RLS/privacy change, out-of-scope deletions, a merge or deploy not covered by pre-approval, model escalation, hitting the repair limit, contradictory evidence, or risk to live users or data. Silence is not approval.

## A3. Cursor CLI: exact launch form
Binary: `~/.local/bin/agent`, signed in to Isaac's Cursor account **[credential: Cursor account login, done once interactively on the build machine]**. Repo access uses `$GH_TOKEN` **[credential: GitHub token with contents write on jimbook42 repos; PR creation needs pull-requests write]**.

```bash
W=/workspace/cursor-<project>-<ticket>
[ -d $W ] || git clone https://x-access-token:$GH_TOKEN@github.com/jimbook42/<repo> $W
cd $W && git fetch -q && git checkout -B <ticket-branch> origin/<base> && \
timeout 60m ~/.local/bin/agent -p --force --model <model> --output-format stream-json \
  "Read the file <ticket file> and carry out the task it describes exactly." \
  > $W.run.jsonl 2>&1; echo exit=$? >> $W.run.jsonl
```
- **Run it in the background** (non-blocking shell) so its completion wakes the PM. Don't use a babysitter sub-agent, setsid or nohup.
- **Ticket text never goes in argv.** Cursor's `pkill -f vite` would match its own command line and kill the session (exit 143). Every ticket says: never use `pkill -f` or `killall`, stop processes by PID only.
- **Stall rule:** if the CLI is alive but the run file and the git worktree have both been unchanged for **10 minutes**, kill that PID only, commit any WIP, and relaunch with `--resume <session_id>` (taken from the stream) on the same ticket. Not a repair. After 2 stalls on one ticket, wait 30 minutes, and tell Isaac only if it keeps happening.
- **Timeout:** 60 minutes by default. Use **90 minutes** only when it's clearly needed, e.g. a heavy computer-vision ticket that already hit 60 while still making progress; log the reason. Never go above 90 without Isaac.
- **Exit 124** (timeout) part-way through: commit and push the WIP checkpoint, then `--resume`.
- **Repairs:** resume the same session with the exact failure. After 2 failed repairs, start a fresh session.
- **Usage log:** one line per run in log.md: ticket, start/end, files changed, lines +/-, exit code.

## A4. Model policy (Isaac, 16 Oct 2026)
- Choose the model **up front by difficulty**. Never start cheap and step up to save tokens.
- **Composer** (`composer-2.5`) is for routine work: UI, copy, small logic, merges.
- **Grok medium/high** (e.g. `grok-4.7-high`) is for hard work: computer vision, tricky state/engine/formula work, hard debugging.
- **Extra-high** (`*-xhigh`) needs Isaac's OK in chat with a clear reason.
- Avoid "Auto". Only Grok and Composer models are in use.
- Note: the older skill text and some bot profiles below still say "always composer-2.5". This policy replaces that.

## A5. Concurrency and machine-load rules
- At most **2 active projects** and **2 Cursor CLI runs** on the box, with **1 per project**. Check with `pgrep -f 'local/bin/agent -p' | wc -l`.
- **Test and build lock:** every heavy test, build or browser run goes through `/workspace/bin/box-test-slot` (full script in A12):
  - tests: `/workspace/bin/box-test-slot npx vitest run --maxWorkers=2`
  - builds: `/workspace/bin/box-test-slot --build npm run build`. A build takes both slots and never runs alongside a test.
  - Slot 1 needs MemAvailable ≥ 3 GB. Slot 2 needs ≥ 6 GB free, load1 < 4, and no build running.
  - It queues up to 20 minutes **outside** a 10-minute timeout. Legacy form: `flock -w 1200 /tmp/box-test.lock timeout 10m <cmd>`. Never `timeout 10m flock ...`.
  - To go back to one test at a time: `touch /tmp/box-test-single`.
- **No nesting:** the lock is taken once, at the outermost command, which exports `BOX_TEST_LOCK_HELD=1`. Scripts skip the lock when that's set. A nested flock waits on itself forever.
- **No servers inside the lock.** Start preview/dev servers outside it and lock only the build and each test run. Kill servers by PID afterwards.
- **No watch mode:** always `vitest run` / `CI=1`.
- **Resource guard:** check `grep MemAvailable /proc/meminfo; head -1 /proc/pressure/memory; uptime` before and after each run. Stop and report if MemAvailable is under 1.5 GB or memory pressure avg60 is over 1.0 for two checks in a row.
- **Shared npm cache:** `npm ci --cache /workspace/.npm-cache --prefer-offline`. On an install error, retry once.

## A6. QA tiers, batching, targeted tests
- **Tier 0** (docs, copy, labels, tiny refactor): Cursor's tests + build + the PM's diff check. No QA bot if CI is green.
- **Tier 1** (normal UI or logic): QA retests the `QA:` block items plus a 2-minute smoke test.
- **Tier 2** (data, auth, migration, formula, save format, anything before a merge or promote): full QA run.
- **One full QA pass per batch** before any merge or release.
- **Batching:** 2 or 3 small related tickets in one CLI run with one QA pass. Never batch risky or unrelated work.
- **Targeted tests:** during a ticket, run only the affected tests. The full suite and a production build are required before merge.
- **QA environment:** a local production build of the exact SHA first: clone or fetch, checkout the SHA, `npm ci && build`, serve on a free port, and check the footer SHA. QA may reuse Cursor's worktree build only if HEAD equals the SHA, the tree is clean, and the footer matches. Use a hosted `qa/<ticket>` preview only when it's really needed (auth, magic links, invites, DB/env, PWA install, final pre-release).
- **Playwright smoke tests:** each UI ticket adds or extends them for its flow, and they run in CI. QA spends its time on judgement checks: looks, wording, flow and edge cases.
- **QA report format:** a verdict line plus one line per finding. Detail goes in RESULTS.md. QA reuses its test accounts and data.
- **Pixel UX review** happens only at release review.

## A7. Release pre-approval (Isaac, 16 Oct 2026)
Hui and Dial-In may merge and release **without asking** when a batch passes full QA with **zero issues flagged**. These still need Isaac's OK: anything flagged, auth/DB/migration/data changes, or any QA doubt. After a pre-approved release, send Isaac a short note with the version, what changed and the prod URL.

## A8. Direct GitHub merges (Isaac, 16 Oct 2026)
When a PR is approved (QA passed, and Isaac said OK or pre-approval covers it), the PM **squash-merges it through the GitHub connector**, but only if every check is green and GitHub says it merges cleanly. A conflict, a failing or pending check, or any doubt goes to the Cursor CLI. Afterwards the PM checks the Vercel production deploy, and rolls back through Cursor if it fails.

## A9. Deploys, versions, databases
- **Vercel** deploys only the production branch and `qa/*` branches. Each repo's `vercel.json` has `git.deploymentEnabled` set to `{ "<prod-branch>": true, "qa/*": true, "*": false, "**": false }`. The free plan allows 100 deploys a day across all projects. Push `qa/<ticket>` only when it's ready. On a 402 quota error, don't retry; fall back to local QA.
- If a normal Vercel promote fails, stop and ask Isaac. Never work around it (e.g. by reassigning an alias).
- **Version footer:** every user-visible release bumps the semver footer (patch = fix, minor = feature). Cursor does the bump inside the ticket. Afterwards, tell Isaac the version and the URL.
- **Supabase** (Hui): read-only unless Isaac approves a specific change. Migrations are applied by the PM through the Supabase connector only after Isaac's OK, with a pre-check of the SQL and a check afterwards (grants, SECURITY DEFINER, overloads). DB migrations don't roll back with the code.
- **Rollback:** use the previous production deployment (Vercel promote via Cursor) or the `automation-start/2026-10-13/<project>` tag.

## A10. Durable PM files (per project)
- `baseline.md`: the immutable start point. Never edit it.
- `state.md`: branch, HEAD, prod SHA, ticket, status, repairs used, open decisions, next action.
- `log.md`: append-only, one line per event.
- `handover.md`: under 40 lines: project/repo/branches/rollback, prod URL+SHA, last ticket, open decisions, risks, next ticket, exact next action, unknowns.
- In the repo: `docs/PROJECT_NOTES.md` (stack, commands, conventions, gotchas). Every ticket tells Cursor to read it first.

## A11. Accounts and infrastructure a new service needs
| Need | Purpose | Credential (value never written down) |
|---|---|---|
| Linux build machine, always on, ~8+ GB RAM, Node 24, git, Chromium/Playwright | Cursor CLI, builds, local QA | machine access |
| Cursor CLI | coding | [credential: Cursor account sign-in] |
| GitHub (account jimbook42) | repos, PRs, checks, merges | [credential: fine-grained token, contents + pull-requests write; read for checks/actions] |
| Vercel (team jimbook) | deploys, logs, rollbacks | [credential: Vercel access via the service's connector or a token] |
| Supabase (Hui only) | read queries, approved migrations | [credential: Supabase connector/management token] |
| Google Drive | design docs, test accounts file, IRC docs | [credential: Drive connector] |
| Bot-to-bot messaging | QA → PM handoff without Isaac copying | n/a |
| Background jobs + wake-on-finish, scheduled tasks | CLI runs, watchdog (hourly, quiet 11pm–7am NZ) | n/a |
| QA test accounts (Hui) | logins for QA | [credential: stored in Drive "Test Accounts.txt". Never copy it into a repo] |

## A12. box-test-slot (full script)
```bash
#!/bin/bash
# box-test-slot [--build] <cmd...>  — box-wide test/build lock, up to 2 tests at once (Isaac, 16 Oct 2026).
# Slot 1 = /tmp/box-test.lock (same as legacy `flock /tmp/box-test.lock`), slot 2 = /tmp/box-test-2.lock.
# Slot 2 only if MemAvailable >= 6 GB, load1 < 4, and no production build running. --build takes BOTH slots.
# Env: BOX_TEST_TIMEOUT (default 10m), BOX_TEST_WAIT (default 1200s). Revert: BOX_TEST_SINGLE=1 or touch /tmp/box-test-single.
L1=${BOX_TEST_L1:-/tmp/box-test.lock} L2=${BOX_TEST_L2:-/tmp/box-test-2.lock}
TO=${BOX_TEST_TIMEOUT:-10m} WAIT=${BOX_TEST_WAIT:-1200}
BUILD=0; [ "$1" = "--build" ] && { BUILD=1; shift; }
[ $# -gt 0 ] || { echo "usage: box-test-slot [--build] <cmd...>" >&2; exit 2; }
# No nesting: already inside a slot -> just run.
[ "$BOX_TEST_LOCK_HELD" = "1" ] && exec "$@"
mem(){ awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; }
building(){ pgrep -f "${BOX_TEST_BUILD_PAT:-(vite|next|tsc -b|npm run|npm exec) build}" >/dev/null 2>&1; }
guards2(){ [ -z "$BOX_TEST_SINGLE" ] && [ ! -e /tmp/box-test-single ] && [ "$(mem)" -ge 6144 ] \
  && awk '{exit !($1<4)}' /proc/loadavg && ! building; }
exec 8>>"$L1" 9>>"$L2"
export BOX_TEST_LOCK_HELD=1
if [ $BUILD = 1 ]; then
  flock -w "$WAIT" 8 || { echo "box-test-slot: timed out waiting for slot 1" >&2; exit 75; }
  flock -w "$WAIT" 9 || { echo "box-test-slot: timed out waiting for slot 2" >&2; exit 75; }
  echo "box-test-slot: build (both slots)" >&2
  exec timeout "$TO" "$@"
fi
end=$(( $(date +%s) + WAIT ))
while :; do
  if [ "$(mem)" -ge 3072 ] && flock -n 8; then exec 9>&-; echo "box-test-slot: slot 1" >&2; exec timeout "$TO" "$@"; fi
  if guards2 && flock -n 9; then
    if guards2; then exec 8>&-; echo "box-test-slot: slot 2" >&2; exec timeout "$TO" "$@"; fi
    flock -u 9
  fi
  [ $(date +%s) -ge $end ] && { echo "box-test-slot: timed out waiting for a slot" >&2; exit 75; }
  sleep 5
done
```

## A13. Bootstrap checklist for a new service
1. Set up the build machine: Node 24, git, Chromium; `npx playwright install chromium`; create `/workspace/.npm-cache`.
2. Install the Cursor CLI at `~/.local/bin/agent` and sign in (Isaac does this himself).
3. Add the GitHub, Vercel, Supabase and Drive credentials to the service's secret store. Put `GH_TOKEN` in the env.
4. Install `/workspace/bin/box-test-slot` (A12) and `chmod +x` it.
5. Create the bots: a PM and a QA per project (plus Chief of Staff if you like). Paste each bot's instructions from Part B's appendix, updated with the facts in Part B.
6. Give every PM the shared skill text (Appendix S below) as its run-book.
7. Create each PM's durable files (baseline/state/log/handover) from Part B's current status.
8. Wire up messaging so QA → PM works, and make sure QA can't message Isaac.
9. Smoke test: run one Tier 0 ticket end to end (Cursor edits docs, CI green, PM verifies, merges and checks deploy).
10. Turn on the hourly watchdog and the load check.

## Appendix S: Shared skill `pm-ticket-loop` (verbatim)
````markdown
---
name: PM ticket loop
description: >-
  Use when a project PM bot runs a coding ticket end to end with Cursor cloud
  agents: pick the next approved ticket, launch Cursor on Composer, verify the
  pushed diff, route QA, repair (max 2), update state and write a short
  handover.
---

# PM ticket loop

Project specifics (repo, branches, URLs, QA bot, limits, gates, ticket template) live in the bot's own config, not here.

## Rules
- Repo docs + GitHub/Vercel evidence beat notes and chat. Never mark PASSED from Cursor's own report.
- Coding is done by the Cursor CLI on the box (Cloud Agents quota exhausted until 4 Nov 2026; CLI uses the normal Cursor Models allowance). ALWAYS `--model composer-2.5`. Any stronger model needs the owner's OK in chat. The PM never edits code itself; it only writes the ticket and launches Cursor.
- Cursor does every write the bot can't: commits, pushes, tags, Vercel promotes, doc updates. The bot itself stays read-only on GitHub, Vercel, Supabase.
- Never merge to the base branch or promote to production without owner approval in chat. Silence is not approval.
- One worktree per ticket. Repairs: rerun the CLI in the same worktree with `--resume <chatId>` (or a fresh run quoting the failure). Max 2 concurrent CLI runs across ALL projects (check `pgrep -f 'local/bin/agent -p' | wc -l`; if >=2, wait for your next watchdog tick).
- Stop and ask at: roadmap/priority change, product/design/formula/architecture decision, migration or data change, auth/RLS/privacy change, deletions out of scope, merge/deploy, model escalation, repair limit hit, contradictory evidence, risk to live users/data.

## Owner contact
- The PM is the owner's only contact point. QA bots report to the PM, not the owner. Relay QA results to the owner in your own summary.

## Steps
1. Load state: the bot's state file + latest handover. Check GitHub: base branch, working branch, HEAD SHA. If anything differs from state, stop and report.
2. Confirm the next ticket is approved in the roadmap. If not clear, ask.
3. Write the ticket in the project's template: goal, scope, non-goals, acceptance criteria, tests, required QA. End it with: commit + push to the working branch, report commit SHA, and a `QA:` block of up to 3 lines saying what to retest.
4. Launch Cursor CLI in the background (Shell block_until_ms 0), log pid + start time:
   `W=/workspace/cursor-<project>-<ticket>; [ -d $W ] || git clone https://x-access-token:$GH_TOKEN@github.com/jimbook42/<repo> $W; cd $W && git fetch -q && git checkout -B <ticket-branch> origin/<base> && timeout 60m ~/.local/bin/agent -p --force --model composer-2.5 --output-format json "Read the file <ticket file> and carry out the task it describes exactly." > $W.run.json 2>&1; echo exit=$? >> $W.run.json`
   Never put the ticket text itself in argv: Cursor often cleans up with `pkill -f vite`/`vitest`, which then matches its own command line and kills the session (exit 143, empty output). Every ticket must say: never use `pkill -f`/`killall`; stop processes by PID only. Prefer a tracked background Shell (no setsid/nohup) and AwaitShell it in the same turn.
   The ticket text must tell Cursor to: verify locally (lint/typecheck/tests/build), commit, `git push origin <ticket-branch>`, and end with the fixed-field report (commit hash, tests, files). Never put secrets in ticket text. On completion read $W.run.json, then verify on GitHub (step 5+) — the CLI's own report is not evidence.
5. On finish: get the pushed SHA from GitHub (not the report). Read the diff. Check scope, unrelated files, acceptance criteria, risky files (migrations, auth, schema, env).
6. Check CI for that SHA (GitHub check runs) must be green. If QA is needed, hand QA the SHA to test as a local production build (see QA environment); only for a pushed `qa/<ticket>` branch wait for the Vercel deployment to be READY and note its URL. Build failure = repair.
7. QA, tiered by risk (pick the tier when writing the ticket and state it):
   - Tier 0, docs/refactor/tiny: Cursor tests + build + your diff check. No QA bot.
   - Tier 1, normal UI/logic: QA bot retests only the `QA:` block items + 2-min smoke.
   - Tier 2, data/auth/migration/formula/save format/anything before merge or prod promote: full QA bot run.
   - Plus one full QA pass per session before any merge or promote.
   Send the QA bot the URL, SHA and items. Use its labelled result. Never call a skipped check passed; mark NOT TESTED or BLOCKED.
8. Fail: reply to the same agent with evidence and failed criteria. Max 2 repairs, then BLOCKED and tell the owner.
9. Pass: update state, append to log, write the handover. Tell the owner only at a gate, a block, or session end. Then prepare the next approved ticket, up to the session limit.

## App version footer
- Every release worth noting (user-visible change, fix, or anything promoted/merged to production) bumps the app's visible version footer (semver: patch = fix, minor = feature). Put the bump in the ticket's scope so Cursor does it with the change. Skip for docs/internal-only tickets.
- After it is live in production, tell the owner in one line: new version, what changed, prod URL, so they can check the live footer matches.
- If the app has no footer yet, add one as a small Tier 0 ticket first.

## QA environment: local production build first, Vercel second
- Default for QA rounds: the QA bot tests a LOCAL PRODUCTION BUILD on the shared box, not a Vercel preview. QA: `git clone`/`fetch` the repo with $GH_TOKEN into /workspace/qa-<project>-<sha7>, checkout the exact SHA, `npm ci && npm run build`, serve with `npx vite preview --port <free port, e.g. 5175> --strictPort` (or the project's preview script), test at http://localhost:<port>, kill the server afterwards. Footer SHA must match.
- Cursor's own localhost lives on its cloud VM and is NOT reachable by QA; Cursor still self-checks (lint, typecheck, tests, build, own browser screenshots) before pushing.
- Vercel deploys only `main` and branches named `qa/<ticket>` (free plan: 100 deploys/day across ALL projects); all other branch pushes never create Vercel deployments. For a hosted preview push the exact SHA to `qa/<ticket>` (e.g. `git push origin HEAD:qa/<ticket>`). Push branches only when ready for QA/merge, never per WIP commit. Use a `qa/<ticket>` preview only when a real hosted preview is needed: Hui changes touching auth/login/magic links, invites, Supabase data/migrations or env vars; service-worker/PWA install behaviour; final pre-release check. Never for Tier 0.
- Hui local builds hit the LIVE Supabase project: UI/labelling-only QA locally is fine; QA must not create junk data beyond its existing test accounts; anything auth/DB goes to a `qa/<ticket>` preview.
- Batch repairs: one QA round per fix batch. On a Vercel 402 quota error don't retry; fall back to local build QA, or mark BLOCKED-QUOTA if a hosted preview is truly required.


## CLI-era QA speedups (14 Oct 2026)
- Ready build: every ticket tells Cursor to finish with a production build in its worktree (`/workspace/cursor-<project>-<ticket>`). QA may serve that folder's build instead of re-cloning, ONLY after confirming `git rev-parse HEAD` equals the SHA under test, the tree is clean, and the app footer shows that SHA. Any mismatch = QA builds fresh. QA never edits the worktree.
- Automated browser tests: each UI ticket also asks Cursor to add/extend Playwright smoke tests for the changed flow, run in CI on every push. QA skips rechecking what green CI tests already cover and spends its time on judgement checks (looks, wording, flow, edge cases). Cursor never does QA sign-off.

- Repairs: resume the same Cursor CLI session with the exact failure; after 2 failed repairs start a fresh session.
- Batching: only tiny related tickets (2-3) in one CLI run, one QA pass; never batch risky or unrelated work.
- Usage log: append per run to log.md: ticket, start/end time, files changed, lines +/-, exit code.
- Shared npm cache: use `npm ci --cache /workspace/.npm-cache --prefer-offline`; on an install error just retry once.
- GitHub Actions minutes: Playwright browser tests run only on PRs/QA-ready branches and main; quick tests on every push. Public repos are unlimited; private free tier ~2,000 min/month. Read checks via the GitHub connector (list_check_runs_for_ref).

## Efficiency rules (15 Oct 2026, quality and control unchanged)
- Watchdog: Cursor CLI completion wakes you; while a run is in flight skip watchdog work. Watchdog cadence hourly (not 20m); quiet hours 11pm-7am NZ unless a run is in flight. Keep normal progress updates to Isaac as before.
- Concurrency (Isaac, 15 Oct 2026 evening): max 2 Cursor CLI runs on the box at once, one per project. ALL heavy test/build commands take turns box-wide via one lock: wrap them as `flock /tmp/box-test.lock <command>` (e.g. `flock /tmp/box-test.lock npx vitest run --maxWorkers=2`, `flock /tmp/box-test.lock npm run build`, playwright scripts). This covers QA runs AND tests/builds Cursor runs inside a ticket: every ticket file must tell Cursor to run tests, builds and browser checks only through that flock wrapper. Don't start if MemAvailable < 3 GB. Resource guard stop rules still apply.
- Tests must never run in watch mode: always `npx vitest run` / `CI=1`, wrapped in `timeout 10m`. Order matters (Isaac, 16 Oct 2026): the lock wait goes OUTSIDE the timeout, so queue time never counts against the test: `flock -w 1200 /tmp/box-test.lock timeout 10m <command>` (up to 20 min queue + 10 min run). Never `timeout 10m flock ...`. Every ticket file must spell this out for Cursor. Kill any dev/preview server you started when done.
- Two tests at once (Isaac, 16 Oct 2026 9:38pm): wrap tests as `/workspace/bin/box-test-slot <command>` (e.g. `/workspace/bin/box-test-slot npx vitest run --maxWorkers=2`) and production builds as `/workspace/bin/box-test-slot --build npm run build`. It queues up to 20 min outside a 10-min timeout (`BOX_TEST_TIMEOUT=20m` to change), sets BOX_TEST_LOCK_HELD=1, and runs nested calls straight through. Slot 1 = /tmp/box-test.lock (3 GB floor); slot 2 only if MemAvailable >= 6 GB, load1 < 4 and no production build is running; `--build` takes both slots (never alongside a test). Hui stays at max 2 workers. The old `flock -w 1200 /tmp/box-test.lock timeout 10m <cmd>` form is still valid (counts as slot 1) but use `box-test-slot` in new tickets. Revert to one at a time: `touch /tmp/box-test-single`.
- Tickets: name exact files/areas and acceptance checks so Cursor doesn't scan the whole repo. Each repo keeps a short `docs/PROJECT_NOTES.md` (stack, commands, conventions, gotchas); first ticket creates it if missing, and every ticket tells Cursor to read it first.
- Fail fast: if CI or Cursor's local checks fail, send repair straight to Cursor; never start QA on red.
- Tier 0 (copy/labels/docs) skips QA when CI is green.
- QA reports: verdict line + one line per finding; detail stays in RESULTS.md. QA reuses its existing test accounts/data across rounds.
- Pixel UX review only at release review, not per ticket.
- Vercel is available again (Isaac has allowance); deploy only for main or `qa/<ticket>` branches per the rules above; stay well under 100/day.

## Durable files (in the bot's store)
- baseline.md: immutable start point (tag, SHAs, prod deploy). Never edit.
- state.md: branch, HEAD, prod SHA, ticket, status, repairs used, open decisions, next action.
- log.md: append-only, one line per event.
- handover.md: short paste-ready text below.

## Handover (under ~40 lines, any AI PM can take over cold)
- Project, repo, base + working branch, rollback tag
- Prod URL + deployed SHA; working HEAD SHA
- Last ticket: ID, status, commit, QA result
- Open decisions for the owner
- Known risks
- Next ticket: ID + one-line goal
- Exact next action
- Unknowns

## Resource guard (15 Oct 2026)
- Max 2 projects active at once; one Cursor CLI run per project at a time.
- Before and after each CLI run check `rg MemAvailable /proc/meminfo` and `head -1 /proc/pressure/memory`. Stop and report to the owner if MemAvailable < 1.5 GB or memory pressure avg60 > 1.0 for two checks in a row.
- Helper count (`pgrep -c -f '^/exec-daemon/node .*box-bounded-log'`) is a guide only: past ~100, suggest a computer reset at a quiet time.

- CLI stalls (Isaac, 16 Oct 2026): Cursor's servers sometimes drop the connection ('Connection lost ... Retry') and the CLI then hangs silently until `timeout` (exit 124). Run the CLI with `--output-format stream-json` into the .run.json file, launched as a background Shell (block_until_ms 0) so its completion notification wakes you; don't keep a separate subagent babysitting it. Stall rule: if the run file and the git worktree have both been unchanged for 10 minutes while the CLI is alive, the run is hung. Kill that CLI by its PID only, commit any WIP, and relaunch with `--resume <session_id>` (from the stream) using the same ticket. A stall relaunch is not a repair attempt. After 2 stalls on one ticket, wait 30 min and tell Isaac only if it keeps happening.
- Never nest the test lock (found 16 Oct 2026): a command run under `flock /tmp/box-test.lock` that itself calls `flock /tmp/box-test.lock` waits on itself forever and the CLI goes silent. Take the lock once, at the outermost command only, and export `BOX_TEST_LOCK_HELD=1` inside it. Any script that takes the lock must skip taking it when `BOX_TEST_LOCK_HELD=1` is set. Ticket files must tell Cursor this.
- CLI timeout (Isaac, 16 Oct 2026 7:45pm): default `timeout 60m`. Raise to `timeout 90m` only when clearly required, e.g. a heavy computer-vision ticket that already hit 60m while still making progress (commits or stream activity). Never above 90m without Isaac. Stall rule above still applies.

## Streamlining (from 16 Oct 2026, approved by Isaac)
All existing rules (test lock, now 2 slots via box-test-slot, 3 GB floor, CLI timeouts, model rules) stay unchanged.
1. **Tiered QA:** low-risk tickets (copy, styling, small isolated fixes) get a quick QA smoke test. One full QA pass per batch is still required before any merge/release.
2. **Batching:** where sensible, group 2-3 small related tickets into one Cursor CLI run (one build/test cycle).
3. **Targeted tests:** during a ticket run only affected tests; full suite + production build required before merge.
4. **Release pre-approval:** Isaac pre-approves merge/production release for Hui and Dial-In when the batch passes full QA with zero issues flagged. Still needs Isaac's OK: anything flagged, auth/DB/migration/data changes, or any QA doubt. After a pre-approved release, send Isaac a short note.

- **Never hold the test lock with a long-lived server.** Start preview/dev servers (e.g. vite preview) outside box-test-slot or the flock, and lock only the build and each test run. A server inside the lock blocks every other test (Hui QA held it 33 min on 16 Oct).

- **Direct merges (Isaac, 16 Oct 2026):** when a PR is approved to merge (QA passed and either Isaac OKd it or the release pre-approval covers it), the PM merges it itself through the GitHub connector (squash-merge), but only if all checks are green and GitHub says it merges cleanly. Any conflict, failing or pending check, or other doubt goes to the Cursor CLI. The PM still checks the Vercel production deploy afterwards and rolls back through Cursor if it fails. PMs still never edit code.
````
