# Duplicate Files Fixer — Desktop Prototype

A working Electron + React prototype covering the core features from the PRD (see `PLAN.md`).

- Folder selection (browse, location picker, or drag-and-drop)
- File type and size filters — with no type picked, **every** file is scanned (RAW photos, TIFFs, anything)
- **Two jobs, nothing else to learn:**
  - **Find duplicates**: search one or more folders. Mark any folder **Keep** and it's compared against but never touched; its copies elsewhere are selected for removal. This is the "reference folder" idea from dupeGuru, Duplicate Cleaner and Czkawka.
  - **Compare folders**: an **Original** against a **Copy**, such as a backup. You get a verdict ("✓ Everything in the Original is also in the Copy", or "⚠ 12 files are missing") and three lists: *Only in Original* (missing from the Copy), *In both*, and *Only in Copy*. Copies in "In both" can be reviewed and removed from the Copy side. Defaults to a Thorough (byte-for-byte) scan.
- **Compare screen**: the colour bar and boxes pick the list. Each list sits in its own scrolling panel with sortable columns, a pinned footer, and a Files / By folder switch.
- **Folder-level decisions** — folders that are fully duplicated collapse into a single row you can select in one click; folders that are only *partly* duplicated are surfaced first, because that's where judgement is actually needed. Selecting a partial folder marks only its duplicated files, never the ones that exist nowhere else.
- **Match confidence** — choose how hard the scan works:
  - *Quick* — name and size only, no file contents read. Fastest; cannot detect renamed copies.
  - *Standard* (default) — 64 KB head hash. Good balance; the recommended setting for network drives.
  - *Thorough* — full SHA-256 of every candidate, byte-for-byte proof of identity.
- **Checked at delete time** — every file is re-checked against the scan and against the copy being kept just before it's removed: it must be unchanged, the kept copy must still exist and be a different physical file, and for Quick/Standard scans (or when the kept copy changed) the two are compared byte-for-byte. Anything that fails is skipped and reported.
- **Signature cache** — file hashes are remembered between scans (keyed on path, size and mtime), so repeat scans of the same tree run at walk speed. Clearable from Settings.
- **Concurrent worker-thread scanning** — the scan runs off the UI thread using async I/O through a bounded concurrency pool (default 32 in flight, with a per-drive cap). This hides per-file latency on NAS/network drives and keeps the worker responsive, so progress keeps flowing and Cancel takes effect immediately mid-walk.
- Auto-mark rules (Find duplicates): a copy in a Keep folder always stays; otherwise keep the newest, oldest or largest.
- **No-survivor guard** — deleting *every* copy in a group requires explicit acknowledgement, so you can't accidentally erase the last copy of a file
- **Exclusion list** — pre-populated defaults (`node_modules`, `.git`, system folders, cloud sync caches), editable in-app
- **Zero-byte file detection** — listed separately from content duplicates (for reference; not deleted)
- **Scan warnings panel** — permission errors, locked files, etc. surfaced instead of silently skipped
- Manual selection override, Select All / Deselect All
- Confirm → delete to the **system Recycle Bin**, with a **quarantine fallback**: network drives (which have no Recycle Bin) and systems where the OS trash can't be reached use a `.dff-quarantine` folder on the **same drive** as the file. **Nothing is ever permanently deleted** — if neither works, the file is left in place and reported.
- **Safety rules enforced in the main process** — Keep/Original files, overlapping folders (e.g. Keep `D:\Photos` inside `D:\`) and one folder reached by two paths (a mapped drive and its `\\nas` path) can never lead to deleting the only copy.
- **Recovery panel** — browse every quarantine folder the app has used and restore files to their original location
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

(or `npm test`). Suites in `src/tests/` import the real modules:
- `scanCore`: type filters, grouping, auto-mark rules and the census behind Compare folders.
- `scanWorker`: runs the real worker thread against temp folders.
- `roots`: overlapping and aliased folders.
- `deleteSafety`: the delete guard, the delete checks, and quarantine/restore on temp folders.
- `exclusions` and `useDPR`.

To check the delete path against a real network share and the Recycle Bin (Windows):

```bash
npx electron tools/phase-a-check.js Z:\ \\server\share
```

It creates and removes its own test folder on the share.

---

## Project Structure

```
├── src/
│   ├── main/
│   │   ├── main.js          ← Electron main process: window, IPC, worker lifecycle
│   │   ├── preload.js       ← Secure IPC bridge to renderer
│   │   ├── scanWorker.js    ← Runs in worker_threads — async concurrent walk + hashing, cancellable
│   │   ├── scanCore.js      ← Pure scan decisions: filters, groups, census
│   │   ├── roots.js         ← Overlapping / aliased scan-root checks
│   │   ├── system.js        ← OS lookups: mapped drives, real paths
│   │   ├── deleteGuard.js   ← Which files may be deleted (checked against the last scan)
│   │   ├── deleteFiles.js   ← Per-file checks + Recycle Bin / quarantine routing
│   │   ├── deleteService.js ← Delete/quarantine/restore wiring used by main.js
│   │   ├── quarantine.js    ← Same-drive quarantine with an append-only manifest
│   │   └── exclusions.js    ← Pure exclusion-matching logic (name/glob/path-prefix)
│   └── renderer/
│       ├── main.jsx         ← React entry point (StrictMode)
│       ├── App.jsx          ← View state machine
│       ├── index.css        ← Design tokens + global styles
│       ├── components/
│       │   ├── TitleBar.jsx / Sidebar.jsx
│       │   ├── FolderBrowserModal.jsx   ← Locations (drives, network) + native folder picker
│       │   ├── ScanOptionsSheet.jsx     ← Types, size, match confidence, auto-mark rule
│       │   └── ExclusionListPanel.jsx   ← Editable exclusion list UI
│       └── views/
│           ├── HomeView.jsx           ← Mode select, folder zones, filters, exclusions, recovery entry
│           ├── ScanView.jsx           ← Live progress (walk → hash → verify), real cancel
│           ├── CompareView.jsx        ← Compare folders: verdict, bar/boxes, sortable list panel
│           ├── ResultsView.jsx        ← Duplicate groups, shield badges, warnings, no-survivor guard
│           ├── RecoveryView.jsx       ← Browse + restore in-app quarantine
│           ├── HistoryView.jsx / SettingsView.jsx
│           └── DoneView.jsx           ← What was recycled, quarantined or left in place
├── src/tests/                ← Vitest suites
├── tools/                    ← bench-smb.js (SMB throughput), phase-a-check.js (NAS delete check)
├── index.html                ← Vite entry
├── vite.config.js
└── package.json
```

---

## Recovering deleted files

Deletion tries three routes, in order:

1. **System Recycle Bin** (`shell.trashItem`) — the normal path on Windows/macOS. Recover these the usual way, from the OS Recycle Bin / Trash on your desktop.
2. **Same-drive quarantine** — used for network drives (the Windows Recycle Bin refuses them) and whenever the OS trash can't be reached. Files are moved (never copied across drives) into `.dff-quarantine` at the top of the file's drive. If that isn't writable, the app tries the scan folder and then your home folder, as long as it's on the same drive. Each folder keeps an append-only `manifest.jsonl`. Browse and restore from **Quarantine** in the sidebar. Restore refuses to overwrite a file that has since reappeared at the original path, and recreates the parent folder if it was removed.
3. **Left in place** — if neither works, the file is not deleted and the Done screen says why. There is no permanent-delete fallback.

The Quarantine panel shows the app's quarantine folders only — not the system Recycle Bin.

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
| Find duplicates | ✅ Any folders; Keep folders never touched |
| Compare folders (backup check) | ✅ Verdict + Only in Original / In both / Only in Copy |
| Auto-mark rules | ✅ Keep folders win; then newest / oldest / largest |
| No-survivor guard | ✅ Explicit acknowledgement before erasing a group's last copy |
| Exclusion list | ✅ Editable, pre-populated defaults |
| Zero-byte file detection | ✅ Listed separately |
| Scan error surfacing | ✅ Warnings panel |
| Grouped results display | ✅ Collapsible groups |
| Manual override | ✅ Click to toggle |
| Confirm before delete | ✅ Modal dialog |
| Safe deletion | ✅ Recycle Bin or same-drive quarantine; never permanent |
| Recover deleted files | ✅ In-app quarantine browse + restore |
| Post-deletion summary | ✅ Animated counter + stats |

---

## Building and packaging

```bash
npm run smoke    # build the page, start Electron hidden, check it renders and a scan works, exit 0/1
npm run pack     # packaged app, unpacked (release/<platform>-unpacked), no installer
npm run build    # installer for the current platform: NSIS (Windows), dmg (macOS), AppImage (Linux)
node tools/run-smoke.js   # smoke-test the packaged app under release/
```

- The installer is **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn. Signing needs a certificate (see `PLAN.md` Sprint 5).
- The app icon is `build/icon.png`, generated by `npm run icon` (`tools/make-icon.js`).
- `src/main` is unpacked from `app.asar`, because worker threads can't load from inside it.
- **If electron-builder fails with `EPERM … rename … win-unpacked.tmp`**, something (usually antivirus) is locking the freshly extracted files in the project folder. Build somewhere else, then point the smoke test at it:
  ```
  npx electron-builder --dir --config.directories.output=%TEMP%\dff-release
  set DFF_RELEASE_DIR=%TEMP%\dff-release && node tools\run-smoke.js
  ```

### Security

- The renderer runs sandboxed with context isolation, and the production page has a strict Content-Security-Policy.
- Navigation, pop-ups, webviews and permission requests are all blocked.
- The main process only accepts IPC from the app's own page.

### CI

`.github/workflows/ci.yml` runs on Windows, macOS and Linux:
- install, `npm test`, and a renderer build;
- an unpacked package;
- the packaged smoke test. On Linux it runs under xvfb.

---

## Roadmap

See `PLAN.md` for the roadmap and product decisions, `REVIEW.md` for the code review behind Phases A–E, and `TESTING.md` for the hands-on test checklist.
