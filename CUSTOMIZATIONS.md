# CUSTOMIZATIONS (Scott’s Mission Control)

This repo is treated as Scott’s locally-owned Mission Control codebase (Windows + OpenClaw-first).

Goal: keep a short, practical record of **what’s been customized**, **why**, and **how to verify it still works** after changes.

---

## Principles

- **Windows-first reliability** (no “works on Linux” assumptions).
- Prefer **OpenClaw config as source-of-truth** (don’t duplicate model lists, cron lists, etc.).
- Avoid fragile shell quoting: run CLIs with `shell:false` and explicit argv.
- If a feature shows “pretty UI” but isn’t wired to real data, either wire it or hide it.

---

## Environment expectations (local)

- Mission Control dev URL: http://127.0.0.1:3000/
- Repo path: `C:\Users\swade\OpenClawVault\tmp\mission-control-bzl`
- OpenClaw config: `C:\Users\swade\.openclaw\openclaw.json`

Key `.env` settings (Windows-safe OpenClaw invocation):

```env
OPENCLAW_CONFIG_PATH=C:\Users\swade\.openclaw\openclaw.json
OPENCLAW_GATEWAY_HOST=127.0.0.1
OPENCLAW_GATEWAY_PORT=18789

# Run OpenClaw via node.exe + openclaw.mjs to preserve args on Windows
OPENCLAW_BIN=C:\nvm4w\nodejs\node.exe
OPENCLAW_ENTRY=C:\Users\swade\AppData\Local\nvm\v22.14.0\node_modules\openclaw\openclaw.mjs
```

> Note: A temporary workaround has sometimes been required due to a config-path resolution bug:
> `OPENCLAW_HOME=C:\Users\swade\.openclaw`.
> Preferred end-state: `OPENCLAW_HOME=C:\Users\swade` and all codepaths honor `OPENCLAW_CONFIG_PATH`.

---

## Implemented customizations (high-signal)

### 1) Windows CLI invocation hardening
**Why:** Calling `openclaw` via shell shims (or with `shell:true`) breaks args like `--text` and results in errors such as “too many arguments for 'event'”.

**Approach:** Execute `node.exe <openclaw.mjs> ...args` with `shell:false`.

**Verify:** Any route that triggers an OpenClaw CLI call works with text containing spaces/newlines.

---

### 2) Coordinator chat reliability
**Why:** Gateway completion payloads sometimes return “no text”, even though the run succeeded.

**Approach:** Coordinator-thread-only fallback to run:
- `openclaw agent --agent coordinator --json`
…and extract reply text from `result.payloads[0].text`.

**Verify:** Coordinator panel replies consistently (no empty messages).

---

### 3) Sync-from-config path resolution (Windows)
**Why:** Some codepaths assumed `C:\Users\swade\openclaw.json`.

**Approach:** Resolve config path via `OPENCLAW_CONFIG_PATH`, then fallback to `C:\Users\swade\.openclaw\openclaw.json`.

**Verify:** “Sync from config” succeeds and reads the correct config.

---

### 4) Command bar API payload fix
**Why:** Frontend sent `{content: ...}` but backend expected `{to,message,from}`.

**Verify:** Command bar sends a message successfully (no validation errors).

---

## In-flight / planned enhancements

### A) Proper Logs drilldown
- Persist OpenClaw gateway events into MC DB
- Activity items link to a **Run detail** view with full timeline + log lines
- Global Logs page backed by persisted events (filters: agent/run/level/time)

### B) Real token/cost telemetry
- Ingest actual usage from OpenClaw run results/events (input/output/total tokens, cached tokens if present)
- Prefer provider-reported **cost** when available; otherwise compute cost only from known pricing
- Fix attribution so usage maps to **real agent ids** (avoid “main” as a junk drawer)

### C) Spawn model list should match OpenClaw config
**User preference:** Only show models actually configured in `openclaw.json` (primary + explicit fallbacks). No generic catalog.

### D) Fix config-path usage everywhere
- All routes should honor `OPENCLAW_CONFIG_PATH`
- `OPENCLAW_HOME` should revert to user home (`C:\Users\swade`) once bug is removed

---

## Quick test checklist

1) **Overview** shows Gateway Online; Live Feed updates
2) **Activity** shows new run entries
3) **Activity → Run detail → Logs** displays a timeline (no “empty” logs)
4) **Tokens / Agent Costs** updates after running a tiny prompt from the UI
5) **Cron** lists jobs from `~\.openclaw\cron\jobs.json`
6) **Spawn** model dropdown only includes configured models from `openclaw.json`

---

## Notes

- This file is intentionally short. Add only what will help Future-Scott debug or extend quickly.
