# Duplicate Files Fixer — Desktop Prototype

A working Electron + React prototype covering the core features from the PRD:
- Folder selection (browse or drag-and-drop)
- File type and size filters
- MD5 hash-based duplicate detection
- Grouped results with auto-mark (keep newest, mark rest)
- Manual selection override
- Confirm → delete to Recycle Bin
- Post-deletion summary screen

---

## Requirements

- **Node.js** 18+ (https://nodejs.org)
- **Windows 10/11** (for Electron shell features like `shell.trashItem`)

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

## Project Structure

```
├── src/
│   ├── main/
│   │   ├── main.js        ← Electron main process (file system, IPC)
│   │   └── preload.js     ← Secure IPC bridge to renderer
│   └── renderer/
│       ├── main.jsx       ← React entry point
│       ├── App.jsx        ← View state machine
│       ├── index.css      ← Design tokens + global styles
│       ├── components/
│       │   └── TitleBar.jsx
│       └── views/
│           ├── HomeView.jsx     ← Folder + filter selection
│           ├── ScanView.jsx     ← Animated scan progress
│           ├── ResultsView.jsx  ← Duplicate groups + delete UI
│           └── DoneView.jsx     ← Summary screen
├── index.html             ← Vite entry
├── vite.config.js
└── package.json
```

---

## Core Feature Coverage (from PRD)

| PRD Feature | Implemented |
|---|---|
| Hash-based duplicate detection | ✅ MD5 via Node `crypto` |
| File type filters | ✅ Photos, Audio, Video, Docs, Archives |
| Size filter | ✅ Configurable minimum |
| Drag-and-drop folders | ✅ |
| Full scan / category scan | ✅ |
| Grouped results display | ✅ Collapsible groups |
| File metadata (name, size, path, date) | ✅ |
| Auto-mark (keep newest) | ✅ |
| Manual override | ✅ Click to toggle |
| Select All / Deselect All | ✅ |
| Confirm before delete | ✅ Modal dialog |
| Recycle Bin deletion | ✅ `shell.trashItem` |
| Post-deletion summary | ✅ Animated counter + stats |

---

## Building for Windows

```bash
npm run build
```

Output: `release/` folder containing an NSIS installer.

---

## Next Steps (not in prototype)

- Similar image detection (histogram/perceptual hash)
- Google Drive OAuth + cloud scan
- In-app Recycle Bin / recovery view
- EML-specific scanning
- Empty folder detection and removal
- Scan progress cancellation
