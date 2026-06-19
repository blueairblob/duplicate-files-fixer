# Duplicate Files Fixer — Development Plan v1.1

## Sprint 1 — Foundation fixes ✅ COMPLETE

These are blocking issues that affect correctness and stability.

### 1.1 Two-pass SHA-256 scanning ✅
Replaced MD5 with SHA-256. Scan now runs as two passes: group files by size first (free), then hash only files that share a size match. Verified via `src/tests/twoPassScan.test.js` and a live smoke test — a folder with 6 files (3 same-size duplicates + 1 unique + 2 empty) hashed only the 3 duplicate candidates, never touching the unique file.

### 1.2 Worker thread for scanning ✅
Scanning moved entirely into a `worker_threads` Worker (`src/main/scanWorker.js`). The main process spawns it, forwards progress events, and the UI stays responsive throughout. Cancellation verified live: a `cancel` message sent to the worker mid-walk is honoured and a `cancelled` result is returned to the renderer.

### 1.3 Linux trash fallback ✅
`shell.trashItem()` is tried first; on failure the file is moved to `~/.dff-quarantine/` with a JSON manifest (`originalPath`, `quarantinePath`, `deletedAt`) recording where it went. A `files:restoreFromQuarantine` IPC handler reverses the move. Verified end-to-end outside Electron: quarantine → manifest write → restore, all confirmed working.

### 1.4 Exclusion list ✅
Persistent (in-memory for now — full persistence lands in Sprint 4) exclusion list in `src/main/exclusions.js`, pre-populated with `node_modules`, `.git`, `System Volume Information`, `$RECYCLE.BIN`, OneDrive/Dropbox cache paths, macOS `.DS_Store`, and our own `.dff-quarantine` folder (so deleted files are never re-scanned). Editable via a new `ExclusionListPanel.jsx` collapsible panel on the Home screen — supports exact names, glob patterns (`*.tmp`), and absolute path prefixes.

**Test coverage:** 45 tests passing across `scanLogic.test.js`, `exclusions.test.js`, and `twoPassScan.test.js`, plus live smoke tests of the real worker thread, cancellation, and quarantine fallback.

**Also delivered this sprint (not originally scoped, added on request):**
- Zero-byte file detection — toggle in scan config, empty files grouped separately by name, never mixed into content-based duplicate groups
- Scan warnings panel — skipped files (permission denied, locked, etc.) surfaced in a collapsible panel in ResultsView instead of failing silently
- Two-phase scan progress UI — "Scanning folders" → "Comparing N of M candidate files" so the two-pass approach is visible to the user, not just faster

---

## Sprint 2 — Enhanced folder browser (cross-platform modal)

Replaces the current native OS picker + separate Locations button with a single in-app browser modal that works consistently on Windows, Linux, and macOS.

### 2.1 Platform-aware location detection in `main.js`

Three platform branches feeding into one unified location format:
- **Windows 11** — PowerShell `Get-PSDrive` for local drives, `Get-SmbMapping` for network shares
- **macOS** — `readdirSync('/Volumes')` gets everything: local drives, USB, network mounts automatically
- **Linux/WSL** — parse `/proc/mounts`, check `/media`, `/run/media`, `/etc/fstab` for network shares; WSL-specific: expose `/mnt/c`, `/mnt/d` etc. as Windows drive shortcuts

### 2.2 Custom browser modal — three-panel layout

Triggered by a single "Browse" button per folder zone, replaces both the native picker and the Locations button:
- **Left panel** — grouped locations sidebar: Quick access, Local drives, Removable, Network
- **Centre panel** — live folder tree for the selected location, breadcrumb trail at top, double-click to drill down, back button, shows subfolder count
- **Right panel** — selected path confirmation, subfolder preview count, "Add folder" button

Works identically on all three platforms. Drag-and-drop onto zones still works as a secondary option.

**Files:** new `FolderBrowserModal.jsx`, rewrite `main.js` `getLocations`, update `HomeView.jsx` to remove Locations button and wire Browse to modal.

---

## Sprint 3 — HiDPI / high-resolution screen support

### 3.1 DPR detection and dynamic scaling

- `main.js` — use Electron's `screen` API to read `scaleFactor` at window creation, set initial window dimensions accordingly
- New `src/renderer/hooks/useDPR.js` — reads `window.devicePixelRatio` on load, writes scaled CSS custom property values to `document.documentElement`
- `index.css` — ensure all font sizes, spacing, and border radii reference CSS variables (audit and fix any hardcoded values)
- Scaling table:

| DPR | Base font | Notes |
|-----|-----------|-------|
| 1.0 | 13px | Standard 1080p |
| 1.25 | 12px | 125% Windows scaling |
| 1.5 | 11px | 150% / 2K screens |
| 2.0 | 10px | Retina / 4K |

- `main.jsx` — wrap app in `DPRContext` provider; all components inherit correct sizes automatically with no individual changes

---

## Sprint 4 — Persistent settings and error surfacing

### 4.1 electron-store for persistent config
Install `electron-store`. Persist: last used folders, preferred auto-mark rule, file type filters, exclusion list, scan mode (compare/simple), window size/position. Users never start from scratch on reopen.

### 4.2 Scan warnings panel
Track skipped files during scan (permission denied, file locked, drive disconnected). Show a collapsible warnings panel at the bottom of ResultsView: "12 files skipped — click to see why." Prevents silent confusion when results seem incomplete.

### 4.3 Zero-byte file detection
Add a toggle in scan config to include zero-byte files. Group them separately in results as "Empty files" rather than mixing with hash-based duplicates.

---

## Sprint 5 — Pre-launch commercial requirements

### 5.1 Licensing and activation
Implement free/pro tier enforcement. Free tier: scan unlimited, delete up to 15 files per session, watermark on summary screen. Pro tier: unlimited deletion, all auto-mark rules, network scan. Use `electron-store` to hold licence key, validate against a simple activation endpoint.

### 5.2 Code signing
- Windows: purchase EV or OV code signing certificate, integrate into `electron-builder` config. Removes SmartScreen warning.
- macOS: Apple Developer Program membership ($99/yr), notarisation via `electron-builder` `afterSign` hook. Required for Gatekeeper.
- Linux: AppImage signing optional but `.deb` package signing recommended for repo distribution.

### 5.3 Opt-in telemetry and crash reporting
Integrate Sentry (free tier covers early launch volume). Capture: unhandled exceptions, scan errors, deletion failures. Prompt user on first launch for opt-in. This is the single most valuable thing for post-launch prioritisation.

### 5.4 Auto-updater
Integrate `electron-updater`. Ship updates silently in the background, prompt to restart when ready. Without this, bugs in v1.0 stay with users forever.

---

## Deferred — post-v1

| Feature | Reason deferred |
|---|---|
| Similar image detection (perceptual hash) | Computationally expensive, needs threading design |
| Google Drive OAuth cloud scan | Auth complexity + API rate limits |
| Mac App Store / Windows Store distribution | Sandboxing restrictions need architectural changes |
| Scheduled/background scans | Requires system tray agent |
| Enterprise audit logs | Different buyer, different product surface |

---

## File change map

| File | Sprints touching it |
|---|---|
| `src/main/main.js` | 1, 2, 3, 4 |
| `src/renderer/views/HomeView.jsx` | 2 |
| `src/renderer/components/FolderBrowserModal.jsx` | 2 (new) |
| `src/renderer/hooks/useDPR.js` | 3 (new) |
| `src/renderer/index.css` | 3 |
| `src/renderer/main.jsx` | 3 |
| `src/renderer/views/ResultsView.jsx` | 4 |
| `src/renderer/views/ScanView.jsx` | 1 |
| `src/tests/scanLogic.test.js` | 1, 4 |
| `src/tests/autoMark.test.js` | 1 (new) |
