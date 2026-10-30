# Holdfast — Roadmap

`REVIEW.md` holds the full code review and the detail of each phase. This file is the short version: what's done, what's decided, and what's next.

## Done

| Phase | What it delivered |
|---|---|
| Sprints 1–3 (original plan) | SHA-256 scanning in a worker thread, Linux trash fallback, exclusion list, folder browser, HiDPI support |
| A — data safety | Main-process delete guard; no permanent deletes; same-drive quarantine with an append-only manifest; overlapping/aliased folder checks; identity dedupe; re-check before every delete; honest Done screen |
| B — correct verdicts | Verify checks source → backup; every file type scanned; Thorough default for Verify; honest Quick/Standard wording; unreadable bucket; drag-and-drop fixed; all tests use real code |
| C — speed and scale | Parallel folder walk (≈3.5× on NAS); no blocking main-process I/O; cancellable pooled deletes; paginated Results; exclusions fixed and persisted |
| D — ship-ready | Sandbox, CSP, navigation/IPC guards; packaged build with icon; smoke-test mode; CI on Windows/macOS/Linux |
| E — polish | Self-test drives the real IPC path (found and fixed a delete-guard bug); accessibility pass; OS-native HiDPI scaling |
| F — two jobs | Home reduced to **Find duplicates** (with per-folder Keep) and **Compare folders** (Original vs Copy, verdict first); Verify mode folded into Compare; Compare list panel with sortable columns |

## Decisions (2026-10-28)

- **Code signing:** paused. Installers stay unsigned for now, so SmartScreen and Gatekeeper will warn.
- **Crash reporting:** none. Quality comes from testing (`TESTING.md`, CI, the NAS check).
- **Licensing:** free, with a "buy me a coffee" donation link. No tiers or limits.
- **HiDPI:** the OS scales the app, as with other desktop apps. The old compact sizing remains as an off-by-default setting.
- **Repo:** public for now; it may become private later.

## Next

0. **Name check before public release.** The app is now **Holdfast**; the old placeholder name clashed with a commercial product. A quick web search found no backup or file app called Holdfast, but before release check the UK/US trademark registers, the app stores and domain names.
1. **Real-world test pass**: work through `TESTING.md` on real data and fix what it finds.
2. **Donation link**: a "Support this app" button in Settings that opens a fixed Buy Me a Coffee page through the main process. Needs the page URL.
3. **Release pipeline**:
   - pushing a `v*` tag makes CI build the installers for each platform and attach them to a GitHub Release;
   - Windows auto-update via `electron-updater` from those releases (macOS auto-update needs signing).
4. **Code signing**, when it's back on the table:
   - Windows: an OV/EV certificate in the electron-builder config.
   - macOS: Apple Developer Program plus notarisation.

## Later / only if needed

- Page scan results from the main process to the screen, if real scans run into memory limits.
- A faster signature-cache format for libraries over ~200k files (SQLite needs a native module, which adds packaging risk).
- Make empty files deletable (they are listed for reference only today).
- Test macOS on real hardware (CI covers the build and the smoke test only).

## Deferred (post-v1)

| Feature | Reason deferred |
|---|---|
| Similar image detection (perceptual hash) | Computationally expensive; needs a pool of workers |
| Google Drive / cloud scan | Auth complexity and API rate limits |
| Mac App Store / Microsoft Store | Sandboxing restrictions need architectural changes |
| Scheduled / background scans | Requires a system tray agent |
| Enterprise audit logs | Different buyer, different product |
