# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Electron + React (Vite) desktop app that finds and safely deletes duplicate files, with a focus on NAS/SMB backup workflows. Plain JavaScript/JSX, no TypeScript, no linter configured. `README.md` documents features; `PLAN.md` holds the sprint roadmap.

## Commands

```bash
npm install            # .npmrc sets legacy-peer-deps=true on purpose (plugin-react peer range predates Vite 8)
npm run dev            # Vite on :5173 + Electron (NODE_ENV=development, UV_THREADPOOL_SIZE=64)
npm run build          # vite build -> dist/, then electron-builder -> release/ (NSIS / dmg / AppImage)
npm run pack           # packaged app, unpacked, no installer
npm run smoke          # vite build + Electron with DFF_SMOKE=1: hidden window, render + scan check, exit 0/1
node tools/run-smoke.js                          # smoke-test a packaged app (DFF_RELEASE_DIR overrides release/)
npm test                                         # all tests (vitest run)
npx vitest run src/tests/exclusions.test.js      # single file
npx vitest run -t "glob"                         # tests matching a name
DFF_PERF=1 npm run dev                           # verbose per-phase/per-file scan timings
node tools/bench-smb.js "<folder>"               # SMB read-throughput benchmark (set UV_THREADPOOL_SIZE=64 first)
node tools/bench-walk.js <parent> [folders] [files] # many-small-folders scan benchmark (creates + removes a tree)
```

Requires Node 20.12+ (Vite 8 needs `util.styleText`; Node 18 crashes). On Windows with a NAS, run natively, not in WSL.

## Architecture

Three process layers:

1. **Main process** (`src/main/main.js`, CommonJS): window creation, all `ipcMain` handlers (folder dialogs, platform-specific location detection for Windows/macOS/Linux/WSL, directory listing, exclusions, delete/quarantine/restore, signature cache info/clear). Spawns one scan worker per scan and forwards its messages to the renderer as `scan:progress`.
2. **Scan worker** (`src/main/scanWorker.js`, `worker_threads`): all scanning. Config arrives via `workerData`; messages out are `progress` / `done` / `cancelled` / `error`; message in is `cancel`. Pipeline: async walk (stat only) -> group by size -> 64 KB head-only "boundary" hash -> full SHA-256 for remaining collisions. `confidence` (`quick` | `standard` | `thorough`) controls how far down that pipeline it goes. Engine modes: `simple` (duplicates among `targetFolders`) and `compare` (`protectedFolders` are never touched; produces a `census` of in-both / source-only / target-only / unreadable). The worker only does I/O; the decisions (type filter, grouping, auto-mark, census, verify report) live in pure `scanCore.js`. With no type filter every file is scanned.
3. **Renderer** (`src/renderer/`, ESM React 18): talks to main only through `window.electronAPI` from `src/main/preload.js`. Adding an IPC call means touching main.js handler + preload.js bridge + caller.

### Security rules (security.js)

- **Register IPC with `handle()` / `on()` in main.js, never `ipcMain.handle` directly.** The wrappers reject calls that don't come from the app's own page.
- The renderer is `sandbox: true`, so `preload.js` may only `require('electron')`.
- Production builds get the CSP from `vite.config.js` (`security.CSP`). Don't add inline scripts or remote resources.
- Navigation, pop-ups, webviews and permissions are blocked for every web contents.
- Packaging: `src/main` is in `asarUnpack`, and the worker loads from `app.asar.unpacked` (`WORKER_PATH`). Keep anything the worker `require`s inside `src/main`.

### Key cross-file behaviors

- **Scan lifecycle lives in `App.jsx`, not `ScanView`.** The user can navigate away mid-scan; `ScanView` only renders `scan.progress`. `runIdRef` invalidates stale completions after cancel/re-scan. View routing is a `view` state machine (`home` | `scanning` | `results` | `verify` | `done`) plus a sidebar `section` when on home.
- **Two user-facing jobs** (`config.job`, see `jobOf` in `utils/scanHistory.js`; old history entries map `simple`→find, `compare`/`verify`→compare):
  - **Find duplicates**: folders, each optionally marked **Keep**. With Keep folders it runs engine `compare` (Keep = protectedFolders); without them, engine `simple`. Results go straight to `ResultsView`.
  - **Compare folders**: **Original** (protectedFolders) vs **Copy** (targetFolders), engine `compare`, default Thorough. It lands on `CompareView`: a verdict (census.sourceOnly = missing from the Copy), bar/boxes choosing the list, and a sortable panel. "Review and delete" drills into `ResultsView` with a scoped selection; Compare UI state lives in App (`compareUi`).
  - There is no separate Verify mode any more.
- **Demo mode:** when `window.electronAPI` is absent (plain browser via `npm run dev:renderer`), `App.jsx` fakes scan progress and results.
- **Delete safety chain** (all decided in main; the renderer only sends paths via `files:delete`):
  - `roots.js` blocks overlapping/aliased roots at scan start (also via `scan:checkRoots` from Home) and gives the worker protected subtrees to skip. The worker dedupes files by `dev:ino` identity.
  - `deleteGuard.js` keeps a session built from the last completed scan. It allows only non-protected group members outside protected roots, and keeps a survivor unless `allowNoSurvivor`.
  - `deleteFiles.js` re-checks each file (unchanged since scan, kept copy present and a different physical file, content hash below Thorough or when the kept copy changed). It then routes to `shell.trashItem` (local paths only) or `quarantine.js`.
  - `quarantine.js` moves files into `<volume>/.dff-quarantine` (then scan root, then home), same-volume only. It keeps an append-only `manifest.jsonl`; known folders are listed in `userData/dff-quarantine-dirs.json`.
  - **Nothing is ever permanently deleted**: if no route works, the file is reported as not deleted.
- **Signature cache:** `userData/dff-signature-cache.json`, keyed on path + size + mtime. Written by the worker, reused by delete-time verification.
- **Persistence:** exclusions persist in `userData/dff-exclusions.json` (defaults in `exclusions.js`; name/glob entries match only below the scan root; path prefixes need a folder boundary). Scan options, history (`utils/scanHistory.js`) and theme (`utils/theme.js`) use renderer `localStorage`.
- **Deletes run as a job:** `executeDeletion` checks up to 4 files at once but moves them one at a time; `files:cancelDelete` stops it, and network files are always content-compared at delete time.
- **Results screen:** groups render 200 per page via the memoized `GroupCard`, and start collapsed above 50 groups. Keep per-click work proportional to what changed.
- **Styling:** design tokens as CSS variables in `index.css` (light/dark via `data-theme`). Use `scale(px)` from `useDPR` for inline sizes. It is 1:1 by default, since the OS handles HiDPI; the old compact sizing only applies when the Settings toggle is on.
- **Accessibility:** keyboard focus must stay visible (`:focus-visible` in index.css). Clickable rows need a role, `tabIndex` and a Space/Enter handler. Modals use `useDialog` (focus in, Tab trapped, Escape closes) with `role="dialog"`.

### Performance constraints (NAS scanning)

- `UV_THREADPOOL_SIZE=64` must be in the environment before Electron starts. The dev script sets it; packaged builds relaunch themselves once to apply it. Setting it later in-process has no effect.
- Boundary hash reads the file head only, on purpose: a tail read is a far-offset seek that is very slow on NAS spinning disks. Don't add a tail read back.
- The walk is one shared pool of `CONCURRENCY` (default 32) runners over a queue of folders and files. Protected roots finish before target roots start, because identity dedupe must keep the protected copy.
- Hashing has extra per-device caps (`ROOT_LIMIT`, `STREAM_ROOT_LIMIT`), keyed by `stat.dev`. Keep worker I/O async so cancel and progress stay responsive.
- The main process must not do blocking I/O. Location detection lives in async `locations.js`, and `cache:info` reads the worker's small `.meta.json` sidecar instead of the cache.

## Tests

Vitest, `node` environment, only `src/tests/**/*.test.js`. `node_modules` is a Windows install: from WSL, run tests through Windows Node with `cmd.exe /c "npx vitest run"`, and never run `npm install` inside WSL on this folder.

Every suite imports real source: `scanCore`, `scanWorker` (spawns the real worker on temp trees), `roots`, `deleteSafety` (guard, executor, quarantine on temp folders), `exclusions`, `useDPR`. Tests must not touch real volume roots; pass `dirs` to `quarantineFile`. `main.js` IPC wiring and cancellation have no automated coverage. `tools/phase-a-check.js` exercises the delete path against a real share inside Electron (from WSL: `cmd.exe /c 'npx electron tools\phase-a-check.js Z:\ \\server\share'`, single quotes).

## Plans

`REVIEW.md` holds the full review and the phased fix plan, with status notes at the end (Phases A–D merged to `main`; Phase E on `phase-e-polish`). `PLAN.md` is the short roadmap with the user's product decisions (no code signing yet, no crash reporting, free + donation link, OS-native HiDPI scaling). `TESTING.md` is the manual real-world checklist.
