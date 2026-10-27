# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Electron + React (Vite) desktop app that finds and safely deletes duplicate files, with a focus on NAS/SMB backup workflows. Plain JavaScript/JSX, no TypeScript, no linter configured. `README.md` documents features; `PLAN.md` holds the sprint roadmap.

## Commands

```bash
npm install            # .npmrc sets legacy-peer-deps=true on purpose (plugin-react peer range predates Vite 8)
npm run dev            # Vite on :5173 + Electron (NODE_ENV=development, UV_THREADPOOL_SIZE=64)
npm run build          # vite build -> dist/, then electron-builder -> release/ (Windows NSIS)
npx vitest run                                   # all tests (no `npm test` script exists)
npx vitest run src/tests/exclusions.test.js      # single file
npx vitest run -t "glob"                         # tests matching a name
DFF_PERF=1 npm run dev                           # verbose per-phase/per-file scan timings
node tools/bench-smb.js "<folder>"               # SMB read-throughput benchmark (set UV_THREADPOOL_SIZE=64 first)
```

Requires Node 20.12+ (Vite 8 needs `util.styleText`; Node 18 crashes). On Windows with a NAS, run natively, not in WSL.

## Architecture

Three process layers:

1. **Main process** (`src/main/main.js`, CommonJS): window creation, all `ipcMain` handlers (folder dialogs, platform-specific location detection for Windows/macOS/Linux/WSL, directory listing, exclusions, delete/quarantine/restore, signature cache info/clear). Spawns one scan worker per scan and forwards its messages to the renderer as `scan:progress`.
2. **Scan worker** (`src/main/scanWorker.js`, `worker_threads`): all scanning. Config arrives via `workerData`; messages out are `progress` / `done` / `cancelled` / `error`; message in is `cancel`. Pipeline: async walk (stat only) -> group by size -> 64 KB head-only "boundary" hash -> full SHA-256 for remaining collisions. `confidence` (`quick` | `standard` | `thorough`) controls how far down that pipeline it goes. Modes: `simple`, `compare` (protected source vs target; produces a `census` of in-both / source-only / target-only), `verify` (backup coverage).
3. **Renderer** (`src/renderer/`, ESM React 18): talks to main only through `window.electronAPI` from `src/main/preload.js`. Adding an IPC call means touching main.js handler + preload.js bridge + caller.

### Key cross-file behaviors

- **Scan lifecycle lives in `App.jsx`, not `ScanView`.** The user can navigate away mid-scan; `ScanView` only renders `scan.progress`. `runIdRef` invalidates stale completions after cancel/re-scan. View routing is a `view` state machine (`home` | `scanning` | `results` | `verify` | `done`) plus a sidebar `section` when on home.
- **Compare results route through `CompareView` first** (when `result.census` exists). It drills down into `ResultsView` with a scoped file selection. Simple-mode results go straight to `ResultsView`.
- **Demo mode:** when `window.electronAPI` is absent (plain browser via `npm run dev:renderer`), `App.jsx` fakes scan progress and results.
- **Delete safety chain** (`files:delete` in main.js): payload is `{ files: [{ path, counterpart }], verify }` (a bare path array is legacy). With `verify`, each file is full-hashed against its kept counterpart right before deletion; mismatches are skipped. Then `shell.trashItem` -> fallback move to `~/.dff-quarantine/` with `manifest.json` -> permanent delete only as last resort. Protected (compare-source) files must never become selectable for deletion; the no-survivor guard requires acknowledgement before removing every copy in a group.
- **Signature cache:** `userData/dff-signature-cache.json`, keyed on path + size + mtime. Written by the worker, reused by delete-time verification.
- **Persistence:** exclusions are in-memory in main (defaults in `exclusions.js`). Scan history (`utils/scanHistory.js`) and theme (`utils/theme.js`) use renderer `localStorage`.
- **Styling:** design tokens as CSS variables in `index.css` (light/dark via `data-theme`). HiDPI scaling via `useDPR` / `DPRContext`; use its `scale(px)` for inline sizes authored at the 13px/1.0 baseline.

### Performance constraints (NAS scanning)

- `UV_THREADPOOL_SIZE=64` must be in the environment before Electron starts. The dev script sets it; packaged builds relaunch themselves once to apply it. Setting it later in-process has no effect.
- Boundary hash reads the file head only, on purpose: a tail read is a far-offset seek that is very slow on NAS spinning disks. Don't add a tail read back.
- I/O goes through a bounded async pool (`CONCURRENCY`, default 32) plus per-drive-root caps (`ROOT_LIMIT`, `STREAM_ROOT_LIMIT`). Keep worker I/O async so cancel and progress stay responsive.

## Tests

Vitest, `node` environment, only `src/tests/**/*.test.js`. Only `exclusions.test.js` imports real source. `scanLogic`, `twoPassScan`, `folderBrowserPaths` and `useDPR` tests **re-implement** the logic inline, so they will not catch changes to `scanWorker.js`, `main.js` or `useDPR.js`. Update the copies by hand when changing that logic. The worker, quarantine fallback and cancellation have no automated coverage.

## Known doc drift

The README project-structure section is stale: `LocationPicker.jsx` was removed (replaced by `FolderBrowserModal.jsx`), and `CompareView`, `HistoryView`, `SettingsView`, `Sidebar` and `ScanOptionsSheet` are not listed. The header comment in `scanWorker.js` says "first+last 64 KB", but the code reads the head only.
