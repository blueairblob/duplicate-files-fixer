# Duplicate Files Fixer — Desktop Prototype

A working Electron + React prototype covering the core features from the PRD, now through **Sprint 1** of the development plan (see `PLAN.md`).

- Folder selection (browse, location picker, or drag-and-drop)
- File type and size filters
- **Two-pass SHA-256 duplicate detection** — size-grouped first, only same-size files are hashed
- **Background worker thread scanning** — UI stays responsive, scans are cancellable mid-walk
- Compare mode: protected source vs. scan target, with shield badges on protected files
- Auto-mark rules: protected-wins, keep-newest, keep-oldest, keep-largest
- **Exclusion list** — pre-populated defaults (`node_modules`, `.git`, system folders, cloud sync caches), editable in-app
- **Zero-byte file detection** — grouped separately from content duplicates
- **Scan warnings panel** — permission errors, locked files, etc. surfaced instead of silently skipped
- Manual selection override, Select All / Deselect All
- Confirm → delete, with **Linux/WSL trash fallback**: if the OS trash fails, files move to an in-app quarantine folder (`~/.dff-quarantine/`) with a recovery manifest, instead of being silently lost
- Post-deletion summary screen

---

## Requirements

- **Node.js** 18+ (https://nodejs.org)
- Tested on **Windows 11**, **Linux/WSL**, and designed to run on **macOS** (untested on real hardware — see Sprint 2 notes)

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (opens Electron + hot-reload React)
npm run dev
```

> **Note:** The first `npm install` will download the Electron binary (~100MB). This only happens once.

---

## Running the tests

```bash
npx vitest run
```

45 tests across three suites:
- `src/tests/scanLogic.test.js` — file inclusion filters, auto-mark rules (all 4), edge cases
- `src/tests/exclusions.test.js` — exclusion list matching: exact names, glob patterns, path prefixes
- `src/tests/twoPassScan.test.js` — the size-grouping logic that makes two-pass scanning fast

The scan worker, quarantine fallback, and cancellation signal have also been verified with live smoke tests against a real file tree (not part of the automated suite, since they need actual disk I/O and a worker thread — see Sprint 1 notes in `PLAN.md` for what was checked).

---

## Project Structure

```
├── src/
│   ├── main/
│   │   ├── main.js          ← Electron main process: IPC, worker lifecycle, delete/quarantine
│   │   ├── preload.js       ← Secure IPC bridge to renderer
│   │   ├── scanWorker.js    ← Runs in worker_threads — two-pass SHA-256 scan, cancellable
│   │   └── exclusions.js    ← Pure exclusion-matching logic (name/glob/path-prefix)
│   └── renderer/
│       ├── main.jsx         ← React entry point
│       ├── App.jsx          ← View state machine
│       ├── index.css        ← Design tokens + global styles
│       ├── components/
│       │   ├── TitleBar.jsx
│       │   ├── LocationPicker.jsx       ← Home/Documents/Drives/Network browser
│       │   └── ExclusionListPanel.jsx   ← Editable exclusion list UI
│       └── views/
│           ├── HomeView.jsx     ← Mode select, folder zones, filters, exclusions
│           ├── ScanView.jsx     ← Two-phase progress (walk → hash), real cancel
│           ├── ResultsView.jsx  ← Duplicate groups, shield badges, warnings panel
│           └── DoneView.jsx     ← Summary, quarantine notice if trash fallback used
├── src/tests/                ← Vitest unit tests
├── index.html                ← Vite entry
├── vite.config.js
└── package.json
```

---

## Core Feature Coverage (from PRD + Sprint 1)

| Feature | Implemented |
|---|---|
| Hash-based duplicate detection | ✅ SHA-256, two-pass (size-grouped, collision-safe) |
| File type filters | ✅ Photos, Audio, Video, Docs, Archives |
| Size filter | ✅ Configurable minimum |
| Drag-and-drop folders | ✅ |
| Location picker | ✅ Home/Documents/Drives/USB/Network, cross-platform |
| Compare mode (protected vs target) | ✅ Shield badges, protected files never selectable |
| Auto-mark rules | ✅ 4 rules incl. protected-wins |
| Exclusion list | ✅ Editable, pre-populated defaults |
| Zero-byte file detection | ✅ Separate grouping |
| Non-blocking scan | ✅ Worker thread, UI stays responsive |
| Scan cancellation | ✅ Verified mid-walk |
| Scan error surfacing | ✅ Warnings panel |
| Grouped results display | ✅ Collapsible groups |
| Manual override | ✅ Click to toggle |
| Confirm before delete | ✅ Modal dialog |
| Safe deletion | ✅ Recycle Bin, with Linux quarantine fallback + manifest |
| Post-deletion summary | ✅ Animated counter + stats |

---

## Building for Windows

```bash
npm run build
```

Output: `release/` folder containing an NSIS installer.

---

## Next: Sprint 2

- Enhanced cross-platform folder browser modal (left: locations, centre: live tree, right: confirm)
- Platform-aware location detection rewrite (PowerShell `Get-PSDrive`/`Get-SmbMapping` on Windows, `/Volumes` on macOS)

See `PLAN.md` for the full roadmap (Sprints 2–5).
