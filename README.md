# Duplicate Files Fixer — Desktop Prototype

A working Electron + React prototype covering the core features from the PRD (see `PLAN.md`).

- Folder selection (browse, location picker, or drag-and-drop)
- File type and size filters
- **Compare summary** — a scan lands on a summary of the *relationship* between the two folders, not a wall of file rows: totals for each side, how many files exist in both, what's only in the source, and what's only in the target. Every figure drills down.
- **Folder-level decisions** — folders that are fully duplicated collapse into a single row you can select in one click; folders that are only *partly* duplicated are surfaced first, because that's where judgement is actually needed. Selecting a partial folder marks only its duplicated files, never the ones that exist nowhere else.
- **Backup-gap detection** — files present in the target but nowhere in the protected source are reported separately. These are the files that are *not* backed up.
- **Match confidence** — choose how hard the scan works:
  - *Quick* — name and size only, no file contents read. Fastest; cannot detect renamed copies.
  - *Standard* (default) — 64 KB head hash. Good balance; the recommended setting for network drives.
  - *Thorough* — full SHA-256 of every candidate, byte-for-byte proof of identity.
- **Verify on delete** — for Quick and Standard scans, each file is hashed and compared against the copy being kept *at the moment of deletion*. Any mismatch is skipped and reported rather than deleted.
- **Signature cache** — file hashes are remembered between scans (keyed on path, size and mtime), so repeat scans of the same tree run at walk speed. Clearable from Settings.
- **Concurrent worker-thread scanning** — the scan runs off the UI thread using async I/O through a bounded concurrency pool (default 32 in flight, with a per-drive cap). This hides per-file latency on NAS/network drives and keeps the worker responsive, so progress keeps flowing and Cancel takes effect immediately mid-walk.
- **Three scan modes:**
  - *Simple* — find duplicates within one or more folders
  - *Compare* — protected source vs. scan target, with shield badges on protected files (never selectable for deletion)
  - *Verify* — check that every file on a target (e.g. desktop) is backed up on a protected location (e.g. NAS); reports backed-up / not-on-NAS / NAS-only
- Auto-mark rules: protected-wins, keep-newest, keep-oldest, keep-largest
- **No-survivor guard** — deleting *every* copy in a group requires explicit acknowledgement, so you can't accidentally erase the last copy of a file
- **Exclusion list** — pre-populated defaults (`node_modules`, `.git`, system folders, cloud sync caches), editable in-app
- **Zero-byte file detection** — grouped separately from content duplicates
- **Scan warnings panel** — permission errors, locked files, etc. surfaced instead of silently skipped
- Manual selection override, Select All / Deselect All
- Confirm → delete to the **system Recycle Bin**, with a **quarantine fallback**: if the OS trash can't be reached (common on Linux/WSL), files move to an in-app quarantine folder (`~/.dff-quarantine/`) with a recovery manifest instead of being lost
- **Recovery panel** — browse the in-app quarantine and restore files back to their original location
- Post-deletion summary screen

---

## Performance on network drives

Scanning a NAS over SMB was the hardest problem in this project, and the fixes are worth knowing about:

- **`UV_THREADPOOL_SIZE` must be set before Electron starts.** Node's default of 4 threads serialises file I/O. The dev script and the packaged build both set it to 64; assigning it in-process is too late to have any effect.
- **The bottleneck was never SMB.** Benchmarking showed the share scaling from 25 files/s serial to ~2,300/s at concurrency 32. The real cost was a far-offset seek per file on the NAS's spinning disks, which is why the boundary hash reads only the head of a file rather than head *and* tail.
- **Concurrency is capped per drive**, because queueing 30+ concurrent reads at a single spinning disk increases latency without increasing throughput.
- **A cold first scan of a large NAS folder is slow** — that's the disk, not the app. The signature cache makes every subsequent scan fast.

### Diagnostics

Verbose per-phase and per-file timings are off by default. To turn them on:

```powershell
$env:DFF_PERF=1 ; npm run dev     # PowerShell
```

```bash
DFF_PERF=1 npm run dev            # bash
```

Without the flag each scan prints a single summary line plus the comparison census.

---

## Requirements

- **Node.js 20.12 or newer** (Node 22 LTS or 24 recommended). The toolchain uses Vite 8, which relies on `util.styleText`; **Node 18 will crash on launch.**
- Tested on **Windows 11** and **Linux/WSL**; designed to run on **macOS** (untested on real hardware).

> **Running on Windows with a NAS?** Run the app natively on Windows, not inside WSL. WSL reaches Windows/NAS paths through a translation layer that makes file scanning dramatically slower.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (Electron + hot-reload React)
npm run dev
```

Notes:

- The first `npm install` downloads the Electron binary (~100 MB). This happens once.
- A project `.npmrc` sets `legacy-peer-deps=true`. This is intentional: `@vitejs/plugin-react`'s declared peer range predates Vite 8, but the plugin works with it. The flag lets `npm install` proceed without `--force`.
- `NODE_ENV` is set via `cross-env` in the `dev:electron` script, so `npm run dev` works the same on Windows, macOS, and Linux.

---

## Running the tests

```bash
npx vitest run
```

Unit suites live in `src/tests/` and cover file-inclusion filters and auto-mark rules (`scanLogic`), exclusion matching by name/glob/path-prefix (`exclusions`), and the size-grouping that makes scanning fast (`twoPassScan`), among others.

> There is no `npm test` script wired up; use `npx vitest run` (add `"test": "vitest run"` to `package.json` if you want `npm test`).

The scan worker, quarantine fallback, and cancellation signal are additionally verified with live smoke tests against a real file tree (not part of the automated suite, since they need actual disk I/O and a worker thread).

---

## Project Structure

```
├── src/
│   ├── main/
│   │   ├── main.js          ← Electron main process: IPC, worker lifecycle, delete/quarantine/restore
│   │   ├── preload.js       ← Secure IPC bridge to renderer
│   │   ├── scanWorker.js    ← Runs in worker_threads — async concurrent three-pass SHA-256 scan, cancellable
│   │   └── exclusions.js    ← Pure exclusion-matching logic (name/glob/path-prefix)
│   └── renderer/
│       ├── main.jsx         ← React entry point (StrictMode)
│       ├── App.jsx          ← View state machine
│       ├── index.css        ← Design tokens + global styles
│       ├── components/
│       │   ├── TitleBar.jsx
│       │   ├── LocationPicker.jsx       ← Home/Documents/Drives/Network browser
│       │   └── ExclusionListPanel.jsx   ← Editable exclusion list UI
│       └── views/
│           ├── HomeView.jsx           ← Mode select, folder zones, filters, exclusions, recovery entry
│           ├── ScanView.jsx           ← Live progress (walk → hash → verify), real cancel
│           ├── ResultsView.jsx        ← Duplicate groups, shield badges, warnings, no-survivor guard
│           ├── VerifyResultsView.jsx  ← Backup-coverage report for Verify mode
│           ├── RecoveryView.jsx       ← Browse + restore in-app quarantine
│           └── DoneView.jsx           ← Summary, quarantine notice if trash fallback used
├── src/tests/                ← Vitest unit tests
├── index.html                ← Vite entry
├── vite.config.js
└── package.json
```

---

## Recovering deleted files

Deletion tries three routes, in order:

1. **System Recycle Bin** (`shell.trashItem`) — the normal path on Windows/macOS. Recover these the usual way, from the OS Recycle Bin / Trash on your desktop.
2. **In-app quarantine** — used only when the OS trash can't be reached. Files move to `~/.dff-quarantine/` with a manifest. Browse and restore them from the **Recover deleted files** panel on the home screen. Restore refuses to overwrite a file that has since reappeared at the original path, and recreates the parent folder if it was removed.
3. **Permanent delete** — last resort only, if both of the above fail.

The Recovery panel shows the in-app quarantine only — not the system Recycle Bin. On native Windows the panel is usually empty, because deletes succeed to the Recycle Bin.

---

## Core Feature Coverage

| Feature | Implemented |
|---|---|
| Hash-based duplicate detection | ✅ SHA-256, three-pass (size → boundary → full hash) |
| Concurrent, non-blocking scan | ✅ Worker thread, async I/O, bounded concurrency pool |
| Scan cancellation | ✅ Responsive mid-walk |
| File type / size filters | ✅ Photos, Audio, Video, Docs, Archives; configurable min size |
| Drag-and-drop folders | ✅ |
| Location picker | ✅ Home/Documents/Drives/USB/Network, cross-platform |
| Simple mode | ✅ Find duplicates within folders |
| Compare mode (protected vs target) | ✅ Shield badges, protected files never selectable |
| Verify mode (backup coverage) | ✅ Backed-up / not-on-NAS / NAS-only report |
| Auto-mark rules | ✅ 4 rules incl. protected-wins |
| No-survivor guard | ✅ Explicit acknowledgement before erasing a group's last copy |
| Exclusion list | ✅ Editable, pre-populated defaults |
| Zero-byte file detection | ✅ Separate grouping |
| Scan error surfacing | ✅ Warnings panel |
| Grouped results display | ✅ Collapsible groups |
| Manual override | ✅ Click to toggle |
| Confirm before delete | ✅ Modal dialog |
| Safe deletion | ✅ Recycle Bin, with quarantine fallback + manifest |
| Recover deleted files | ✅ In-app quarantine browse + restore |
| Post-deletion summary | ✅ Animated counter + stats |

---

## Building for Windows

```bash
npm run build
```

Output: `release/` folder containing an NSIS installer.

> `npm run build` (electron-builder) is where the dev-only `brace-expansion` audit advisories and the blocked `electron-winstaller` install script live. They don't affect `npm run dev`; address them when you cut an installer.

---

## Roadmap

See `PLAN.md` for the full roadmap (Sprints 2–5), including the enhanced cross-platform folder browser and the platform-aware location detection rewrite.
