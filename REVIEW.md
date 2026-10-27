# Codebase Review and Plan — October 2026

Full review of `src/` and `tools/` at commit `d98d8a83`.

## Summary

The scanning engine is well built. It uses async I/O through a bounded pool, caps reads per drive, keeps a signature cache, cancels cleanly, and its comments explain why each choice was made. The UI has a clear structure, and the scan lifecycle in `App.jsx` is sound.

The weak point is the part that matters most for this product: **making sure the user never loses a file they meant to keep, and never gets a false "you're backed up".** Several paths can delete the only copy of a file, or report a backup as complete when it isn't. None of them needs a big redesign. Most need a guard in the main process and a check of file identity. They should all be fixed before anyone uses the tool on real data.

Second priority: **scale**. Results, payloads and the delete flow are not built for the large NAS trees the scanner was tuned for.

---

## Part 1 — Findings

Severity:
- **Critical:** can lose data or give a false backup verdict.
- **High:** wrong results, or a broken feature.
- **Medium:** performance, robustness or security hardening.
- **Low:** polish.

### Critical

**C1. Verify mode checks the wrong direction.**
- `HomeView.jsx:246,254` labels the left zone "Source — the original files" (sent as `protectedFolders`) and the right zone "Backup — checked for completeness" (`targetFolders`). The tooltip (`:217`) says *"Check every source file is present in the backup"*.
- The worker and `VerifyResultsView.jsx:49,142` do the opposite. They treat `protected` as the NAS/backup and report "unbacked" as files in the *target* that are missing from the *source*.
- Result: a user who follows the UI gets "✓ Every desktop file was found on the NAS" even when thousands of originals are missing from the backup. Those missing files land in the collapsed "Only on NAS" section.
- This is the core promise of Verify mode.

**C2. "Permanent delete" is the normal path on WSL/Linux, and may be on Windows network drives.**
- In `main.js:545-571`, if `shell.trashItem` fails, the code tries `renameSync` into `~/.dff-quarantine`. If that fails too, it calls `unlinkSync`.
- A rename across filesystems always fails with `EXDEV`. Any file on `/mnt/c`, `/mnt/d`, a NAS mount or a USB drive is on a different device from `~`. On WSL, where trash also fails, every delete is therefore permanent.
- These files are reported as `deleted`, not as permanently removed. `DoneView.jsx:126` then tells the user they are in the Recycle Bin and "you can still recover them".
- **Needs testing on Windows:** whether `trashItem` on an SMB/mapped drive with no Recycle Bin also deletes permanently without a prompt. Deleting duplicates on the NAS target is the main use case.
- **Fix:**
  - Fall back to a copy, then fsync, then unlink into a quarantine folder on the same volume (for example `<root>/.dff-quarantine`).
  - Never `unlink` silently.
  - Report permanent deletes separately, and require explicit consent before any happen.

**C3. The same physical file under two paths is treated as a duplicate of itself.**
- Examples: `\\nas\photos\a.jpg` vs `Z:\photos\a.jpg` (mapped drive), a junction or symlinked parent, or differing letter case on Windows.
- In Compare mode the "target" copy is auto-marked. Verify-on-delete hashes the file against itself, passes, and deletes it. That deletes the protected original.
- The `seenPaths` dedupe (`scanWorker.js:501`) only catches identical path strings.
- **Fix:**
  - Record `dev`+`ino` from `stat` (or `realpath`) during the walk, and dedupe on identity.
  - In the delete handler, refuse when the file and its counterpart resolve to the same identity.

**C4. Overlapping roots can delete protected files.**
- Example: protected `D:\Photos`, target `D:\`. Each file under `D:\Photos` is walked twice, once with each label.
- Census (`scanWorker.js:381-415`) maps the target entry to the protected entry's group, so the protected folder shows up as a "fully duplicated" target folder. Its `matchedPaths` are the protected files' own paths.
- Ticking it seeds `ResultsView` `marked` with those paths (`ResultsView.jsx:47-48`), and nothing filters out protected paths.
- Files with no group get `counterpart: null`. In Thorough mode (no verify) they are sent straight to delete, with no no-survivor warning.
- **Fix:**
  - Reject or normalise overlapping roots at scan start.
  - Filter `marked` to non-protected files that appear in groups.
  - Enforce "never delete under a protected root" in the main process (see M1).

**C5. Files with unlisted extensions are ignored, even with "All file types".**
- `SUPPORTED_EXTS` (`scanWorker.js:87-93`) is an allowlist. Missing types include RAW photos (`.cr2 .nef .arw .dng .orf .rw2`), `.tif/.tiff`, `.heif`, `.m4v`, `.mts`, `.3gp`, `.psd`, `.csv`, `.odt` and many more.
- Verify and Compare silently leave these out, so a photographer's RAW files are never checked. The backup gap report is incomplete with no warning.
- **Fix:** with "All file types", include every file. Use the type map only when the user picks types.

### High

**H1. Drag-and-drop of folders is broken.** `HomeView.jsx:31` reads `File.path`, which Electron removed in v32. The project uses Electron 43, so drops add nothing. Use `webUtils.getPathForFile` exposed through `preload.js`.

**H2. Thorough mode has no check at delete time.**
- `needsVerify` is false for Thorough (`ResultsView.jsx:101`). Results can be stale: the kept copy may have been moved, deleted or edited since the scan.
- Always check, before each delete, that the counterpart exists and that both files' size and mtime still match the scan. That costs a `stat`. Keep the full-hash compare for Quick/Standard.

**H3. Standard mode's "backed up" verdict is based on the first 64 KB only.**
- A backup copy that is corrupt or truncated past the head, at the same size, counts as backed up. That is the kind of silent corruption a backup verifier exists to catch.
- Verify mode should default to Thorough, or at least label its result "likely backed up".

**H4. Quick-mode results are presented as fact in Compare.**
- `CompareView` shows green ticks, "all in source" and "safe to remove" (`:162`), plus "not in source" counts on folder rows and in the footer.
- Only the "Only in target" tile shows a caveat. Apply `isQuick` across the screen.

**H5. Compare folder rows merge across target roots** (`scanWorker.js:400`). Folders are keyed by the path relative to their root, so `A:\Photos` and `B:\Photos`, plus every root's top-level files (`.`), merge into one row. Key by `root + rel`.

**H6. The quarantine manifest can be wiped.**
- `appendManifest` (`main.js:450-460`) treats an unreadable manifest as `[]` and overwrites it, which destroys every earlier recovery record.
- It also swallows write errors. A file can be moved into quarantine with no manifest entry, so it becomes invisible to the Recovery screen.
- It does a read-modify-write per file, which is O(n²) on a bulk delete.
- **Fix:** write atomically (tmp file + rename), refuse to overwrite a manifest that fails to parse, and append in batches.

**H7. The Done screen misreports what happened.**
- "Space freed" uses `markedBytes` even when files were skipped or failed (`DoneView.jsx:83`).
- "All cleaned up" and "Moved to the Recycle Bin" show regardless of skipped files or permanent deletes.

**H8. Zero-byte detection is invisible.** The worker returns `emptyFiles`, but nothing in the renderer displays them, although the README lists this as a feature.

**H9. Files that failed to hash are counted as "not backed up" / "only in target".** Census and Verify should report a separate "could not read" bucket rather than putting them in either side.

**H10. The packaged build fails.** `package.json` sets `win.icon: public/icon.png`, and `public/` does not exist. There is no mac or Linux target despite the cross-platform claims. A packaged build has never been tested, including whether `scanWorker.js` loads from inside the asar archive.

### Medium

**M1. The main process trusts the renderer for deletion** (`files:delete`). Any path can be deleted. The main process should keep the last scan's result and protected roots, and refuse paths that:
- are not in a duplicate group,
- sit under a protected root, or
- would leave a group with no surviving copy without an explicit flag.

This also makes C3 and C4 impossible to reach.

**M2. Electron hardening is missing.**
- No `sandbox: true`.
- No CSP in `index.html`.
- No `will-navigate` / `setWindowOpenHandler` guards. Dropping a file outside a drop zone navigates the window to it.
- The `fs:listDirectory` IPC is unused but still exposed.

**M3. Synchronous I/O in the main process freezes the UI.**
- `getLocations` runs two `execSync` PowerShell calls (`main.js:135-207`).
- `cache:info` and delete-time verify `JSON.parse` the whole signature cache. It holds up to 500k entries and can be 100 MB+.
- Quarantine uses `renameSync`/`existsSync`.
- Move this work to async I/O or the worker.

**M4. Deleting has no progress, no cancel, and runs one file at a time.** A verify-on-delete of 10k NAS files hashes both copies of each file fully, with only "Deleting…" on screen for possibly hours. Stream progress events, allow cancel, and run verify through a small pool.

**M5. Results are not built for scale.**
- `ResultsView` renders every group, all expanded, with no virtualization.
- `marked → counterpart` uses `groups.find` per path, which is O(n·g).
- `markedBytes` rebuilds a flat list on every render.
- The worker posts the full `groups` array, which the structured clone copies twice (worker → main → renderer).
- **Fix:** virtualize lists, build a `path → group` map, and page or summarise results in main.

**M6. The per-root limiter only works for Windows paths.** `rootOf` returns `'?'` for every POSIX path (`scanWorker.js:177-182`), so on macOS/Linux/WSL all drives share one gate (8 boundary reads, 3 full streams). That throttles local SSD scans and mixes NAS and local drives. Use `stat.dev` as the gate key.

**M7. The walk visits subdirectories one at a time** (`scanWorker.js:354-357`). Concurrency only applies to files inside a single directory. Trees with many small folders, which is typical for photo archives, are latency-bound. Feed directories into the pool too.

**M8. Exclusion matching is too broad and slow** (`exclusions.js`).
- Segments of the user's chosen root are matched as well, so a root under `.cache` or any folder named `Windows` scans as empty with no warning.
- The default `Windows` exclusion hides any user folder with that name.
- Path-prefix matching has no separator boundary, so `D:/Photos` also excludes `D:/Photos-old`.
- Glob regexes are recompiled for every file.

**M9. Exclusions are not persisted.** They live in memory and reset on restart, while scan options, history and theme persist. Persist them next to the options.

**M10. Tests give false confidence.**
- 4 of 5 suites test copies of the logic, not the real code.
- The worker, delete chain, quarantine and census have no tests.
- `node_modules` was installed on Windows, so `npx vitest run` fails under WSL (missing `rolldown` linux binding).

### Low

- CompareView items from the earlier review:
  - `Mark`, `Check`, `Tile` and `FileList` are defined inside render, so they remount on every update.
  - The partial-folder list has no cap.
  - There is a double border above the footer.
  - "and N more" counts against a list already capped at 5000.
  - "none" folders have no icon.
- The `DPR` scaling makes text smaller on HiDPI displays (13 → 10 px at 200%), and `devicePixelRatio` also changes with Ctrl+zoom, so zooming in shrinks fonts. Revisit the design.
- `HomeView` `exclusionCount` is never passed in.
- `main.js` has a duplicate `worker.on('error')`, and its comment says concurrency defaults to 16 while the code uses 32.
- When a scan is superseded, `activeWorker.terminate()` leaves the old `scan:start` promise unresolved forever.
- In a scoped review, "Auto-select duplicates" re-marks files outside the selected folders.
- The window background is hard-coded dark (`#0d0f14`), so light theme flashes dark on open.
- Doc drift: README structure, and the `scanWorker.js` header comment says "first+last 64 KB".

---

## Part 2 — Fix plan

Order: data safety first, then correctness, then scale. Each phase can ship on its own.

### Phase A — Stop data loss (blocker for any real use)

1. **Delete guard in main (M1).** Main stores the last scan result plus protected roots. `files:delete` refuses:
   - paths not in a group,
   - paths under a protected root,
   - a counterpart with the same identity as the file,
   - groups left with no survivor unless explicitly flagged.
2. **File identity (C3).** Record `dev`/`ino` (and the `realpath` of each root) in the walk. Dedupe on identity. Block deletes where the file and its counterpart are the same.
3. **Root validation (C4).** At scan start, reject protected/target overlap, and the same root resolving under two paths. Show a clear message on the Home screen.
4. **Quarantine on the same volume (C2).** Use per-volume `.dff-quarantine` with an atomic, batched manifest (H6). On cross-device moves, copy, verify the hash, then unlink. Never silently `unlink`. Permanent delete becomes an explicit, separately confirmed option.
5. **Check before every delete (H2).** Before each delete, `stat` both files and compare against the scan; for Quick/Standard also full-hash.
6. **Honest Done screen (H7).** Show trashed, quarantined, permanently deleted, skipped and failed separately, and compute freed bytes from what was actually removed.
7. **Tests for all of the above.** Run real `main.js` logic (extract delete and quarantine into a module that doesn't depend on Electron) against temp dirs, including EXDEV simulation, alias paths and overlapping roots.

### Phase B — Correct verdicts

1. Fix the Verify direction (C1). Rename internals from `nas`/`desktop` to `source`/`backup` so the mistake can't creep back.
2. "All file types" means all files (C5).
3. Verify defaults to Thorough. Label Standard results as "likely" (H3). Apply quick-mode caveats across Compare (H4).
4. Key folder rows by root (H5). Add a "could not read" bucket (H9). Show empty files (H8).
5. Fix drag-and-drop with `webUtils.getPathForFile` (H1).
6. Rewrite the copied-logic tests to import real modules. Split `scanWorker.js` into pure functions (grouping, census, verify report, auto-mark) plus a thin I/O shell.

### Phase C — Scale and responsiveness

1. Gate per root by `stat.dev`. Run directories through the pool (M6, M7).
2. Delete as a job: progress events, cancel, pooled verify (M4).
3. Results payload and rendering: virtualized lists, `path → group` map, results held in main and paged to the renderer (M5).
4. Move main-process sync I/O to async (M3). Replace the JSON signature cache with SQLite (`better-sqlite3`) or an append-only log, so 500k entries don't need a full parse and rewrite on every scan.
5. Exclusions: match relative to the scan root, add segment boundaries, precompile, and persist (M8, M9).

### Phase D — Ship-ready

1. Electron hardening (M2): `sandbox: true`, CSP, navigation and window-open guards, and remove the unused IPC.
2. Packaging (H10): add icons, mac (dmg) and Linux (AppImage/deb) targets, and smoke-test the packaged app scanning (worker inside asar).
3. CI: GitHub Actions on Windows, macOS and Linux running vitest, a build, and a packaged-app smoke scan of a fixture tree.
4. Clear the CompareView polish items, fix doc drift, and add `"test": "vitest run"`.

---

## Part 3 — Roadmap to technical success

What "technical success" should mean for this tool, and how to measure it:

**1. Safety first, and provable.** The product's whole value is "delete with confidence".
- Encode the safety rules as invariants enforced in the main process, not the UI:
  - a protected file is never deleted,
  - a group always keeps a survivor,
  - every delete is recoverable unless explicitly consented,
  - an alias is never treated as a duplicate.
- Back each rule with tests, including property-based tests (fast-check) that generate random trees, aliases and overlaps and assert the invariants hold.
- Keep an append-only audit log of every delete (path, counterpart, hashes, route taken). A user can then always answer "what did it do?".

**2. Correct verdicts, honestly labelled.**
- Every count on screen should come from one census model, with its confidence and its unknowns ("could not read", "excluded", "unsupported").
- A backup verifier that says "all good" must have read every byte, or say plainly that it didn't.

**3. Performance budgets, measured.**
- Turn `tools/bench-smb.js` and `DFF_PERF` into a repeatable benchmark with fixture trees: local SSD, many small folders, and a simulated high-latency share.
- Track files/s for walk, boundary hash and full hash, plus peak memory, in CI.
- Targets:
  - repeat scans at walk speed (cache),
  - a UI that never blocks for more than 100 ms,
  - 1M-file trees without running out of memory.

**4. Architecture that scales with features.**
- Split the worker into pure core logic (testable) plus an I/O adapter.
- Hold results in main or SQLite and query them from the renderer, instead of shipping giant arrays.
- Introduce `electron-store` (or SQLite) as the single settings and state store, replacing the mix of in-memory and `localStorage`.
- TypeScript (or JSDoc + `tsc --checkJs`) on the IPC contract, so main, preload and renderer can't drift apart.

**5. Release engineering.**
- Code signing and notarisation, auto-update, and opt-in crash reporting (PLAN.md Sprint 5).
- These only make sense after Phases A–B. Shipping auto-update ahead of the safety fixes would spread a data-loss bug faster.

**6. Product features that become feasible on this base.**
- Content-defined "folder sync status" (what Compare already does, persisted over time).
- Scheduled verify runs.
- Hard-link instead of delete as a space-saving option on the same volume.
- Perceptual image matching (needs the worker refactor and a pool of workers).

---

## Phase A — status and manual checks

Phase A is implemented on branch `phase-a-safety` (122 automated tests passing). Each finding is handled as follows:
- **C2:** no permanent-delete path remains.
- **C3:** files are deduplicated by identity, and deletes are re-checked by identity.
- **C4:** overlapping roots are blocked or skipped, and the main-process guard enforces the protected-file rule.
- **H2:** every delete is re-checked against the scan.
- **H6:** the quarantine manifest is append-only and stored per volume.
- **H7:** the Done screen reports what actually happened.
- **M1:** the main process owns delete decisions.

Phase B fixes are still open, including **C1** (Verify direction) and **C5** (file-type allowlist).

These checks need a real Windows desktop and NAS, and can't be automated. Use a throwaway NAS folder with copied files only. Start the app with `npm run dev` from a Windows terminal.

1. **Mapped drive vs UNC (C3).** Compare with protected `\\nas\share\dff-test` and target `Z:\dff-test` (the same folder through the mapped drive). Expected: the scan is refused with "the same folder".
2. **Overlap (C4).** Use protected `Z:\dff-test\keep` and target `Z:\dff-test`. Expected: the scan runs, and no file under `keep` appears as deletable. Then swap the two. Expected: the scan is refused.
3. **NAS delete goes to quarantine (C2).** Compare a local folder against `Z:\dff-test\dupes` and delete a few duplicates. Expected:
   - the Done screen says they were moved to a `.dff-quarantine` folder;
   - `Z:\.dff-quarantine` contains the files and a `manifest.jsonl`.
4. **Restore.** Open Quarantine in the sidebar and restore one file. Expected: it reappears at its original path.
5. **Changed since scan (H2).** Scan, then edit one target duplicate in another app (so its mtime changes), then delete it. Expected: "File changed since the scan — not deleted".
6. **Kept copy gone (H2).** Scan, then rename the protected copy, then delete its duplicate. Expected: "The kept copy is missing — not deleted".
7. **Every copy selected.** Simple scan, select every copy of one group, and delete without ticking the acknowledgement. Expected: the Delete button is disabled. With the acknowledgement ticked, the files go to the Recycle Bin or quarantine, never a permanent delete.
8. **Local delete.** Delete a duplicate on a local drive. Expected: it appears in the Windows Recycle Bin.

### Phase A — automated NAS run (2026-10-27)

`npx electron tools/phase-a-check.js Z:\ \\192.168.0.101\public` passed all 13 checks against the real share and the Windows Recycle Bin. That covers steps 1–8 above, except the Delete button state in step 7; the guard logic behind that button is covered.

Things learned on the real share:
- **`shell.trashItem` refuses network files** ("Failed to perform delete operation") and leaves them in place. The old code then tried to rename the file into `C:\Users\…\.dff-quarantine`, which fails across drives, and fell through to `unlinkSync`. **Before Phase A, every NAS delete on Windows was permanent.** This confirms C2.
- **File identity works on this SMB share.** The mapped `Z:` path and the UNC path report the same `dev:ino`, so the identity dedupe also catches aliases the root check might miss.
- **The SMB client caches timestamps for about 10 seconds** (`FileInfoCacheLifetime`). A file edited moments before a delete can still show its old mtime. Below Thorough, the content hash catches the edit. In Thorough mode, a same-size edit made in the last ~10 s before deleting the file would not be caught, but the file still goes to quarantine and can be restored. Consider always hashing network files at delete time (Phase C).

---

## Phase B — status

Done on branch `phase-b-verdicts`:
- **C1:** Verify now answers "is every source file in the backup?". Its buckets are missing, backed up, only in the backup, and couldn't read. The headline only says all is well when nothing is missing and nothing failed to read.
- **C5:** with no type filter, every file is scanned. The type filters now include RAW, TIFF, HEIF and more.
- **H3:** Verify defaults to Thorough, with its own saved setting. Standard results are worded "likely backed up", and Quick results "same name and size".
- **H4:** Quick-mode wording is applied across Compare.
- **H5:** folder rows are keyed by target root plus path.
- **H8:** empty files are listed in Results.
- **H9:** files that couldn't be read get their own bucket.
- **H1:** folder drag-and-drop uses `webUtils.getPathForFile`.
- **Tests:** the scan decisions moved into `scanCore.js`, and every suite now imports real code. The copied-logic suites were removed: `scanLogic` and `twoPassScan` were replaced by `scanCore.test.js`, and `folderBrowserPaths` tested code the app no longer uses.
- **Low items:**
  - CompareView components are now module-level.
  - The partial-folder list is capped, with "show more".
  - Partial rows show matched counts and reclaimable bytes.
  - "None" folders get an icon.
  - The doubled border is fixed.
  - "N more" counts are accurate.
  - `npm test` is wired up.
