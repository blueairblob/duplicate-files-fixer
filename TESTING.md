# Real-world test checklist

A hands-on pass over everything changed in Phases A–D, using your own files. Allow about an hour. Work through it in order, and note anything that looks wrong, reads confusingly or feels slow. Odd wording counts too.

**Safety first:** run every delete test against **copies**. Nothing is ever permanently deleted: files go to the Recycle Bin or to a `.dff-quarantine` folder on the same drive. Still, keep real originals in **Keep** folders (Find duplicates) or the **Original** box (Compare folders) until you trust the app.

---

## 0. Setup (10 min)

1. Start the app from **Windows PowerShell**, not WSL:
   ```powershell
   cd D:\dev\PROJECTS\duplicate-files-fixer
   npm run dev
   ```
   The terminal should print `[perf] UV_THREADPOOL_SIZE = 64`.
2. Pick a real photo folder of a few GB, ideally one that includes RAW files (`.cr2`, `.nef`, `.arw`, `.dng`). Copy it twice:
   - `D:\dff-real\originals`, which plays the role of your originals;
   - `Z:\dff-real\backup`, which plays the role of your NAS backup.
3. Change the **backup** copy so there's something to find:
   - delete **3 files**, at least one of them a RAW file if you have any;
   - **rename** 1 file (same contents, new name);
   - open 1 photo and **save it with a small edit**, such as a rotation or a rating;
   - add 1 new file that exists **only** in the backup.

Write down what you changed; the tests below check that the app finds it.

---

## 1. Home: two jobs

- [ ] Home offers exactly two choices: **Find duplicates** and **Compare folders**.
- [ ] In Find duplicates, each folder row has a **Keep** switch. A kept folder shows a shield and tinted row.
- [ ] Marking every folder Keep disables the start button and explains why.

## 2. Compare folders: is everything backed up?

1. Home → **Compare folders**. Original = `D:\dff-real\originals`, Copy = `Z:\dff-real\backup`.
2. Open **Scan options**. Match confidence should default to **Thorough**, marked Recommended. Click **Compare**.

**Expect:**
- [ ] The verdict at the top says **"⚠ 4 Original files are missing from the Copy"**: the 3 deleted plus the edited one, since its contents changed.
- [ ] **Show missing files** (or the **Only in Original** box) lists exactly those 4, RAW files included.
- [ ] The **renamed** file appears under **In both**, next to its "Same file in Original".
- [ ] **Only in Copy** shows your added file (and the edited version).
- [ ] The bar segments and boxes switch the list. The chosen one is highlighted, and the list title says what you're looking at.
- [ ] Column headers sort the list, and the footer stays visible while you scroll.
- [ ] **By folder** shows the folder table. Tick a folder, then **Review N selected**, and Results opens with only those files ticked. **Back to Compare** returns to the same list.

Note how long the scan took: ______

## 3. Compare folders, Standard and Quick match

Repeat test 2 with **Scan options → Standard**, then with **Quick**.

- [ ] Standard: the verdict notes that only the first 64 KB were compared.
- [ ] Quick: the wording changes to name/size matches, **Only in Copy** is greyed out, and a note explains why.

## 4. Find duplicates with a Keep folder

1. Home → **Find duplicates**. Add `D:\dff-real\originals` and mark it **Keep**. Add `Z:\dff-real\backup` (not Keep).
2. Click **Find duplicates**.

**Expect:**
- [ ] Results opens straight away, with no Compare summary.
- [ ] Files in the Keep folder show a shield ("Keep folder") and can't be ticked.
- [ ] The copies in the backup are pre-ticked.
- [ ] Without any Keep folder, the newest copy in each group is kept by default; change this under Scan options.

## 5. Delete from the NAS, then restore

1. From test 4's results, select about 10 files on `Z:`, then **Delete**.

**Expect:**
- [ ] The Done screen says the files went to a **.dff-quarantine folder on the same drive** (network drives have no Recycle Bin).
- [ ] `Z:\.dff-quarantine` exists and holds them, along with a `manifest.jsonl`.
- [ ] **Space freed** matches what you deleted.
- [ ] Sidebar → **Quarantine** lists them. **Restore** one, and it reappears at its original path.

## 6. Stop a delete part-way

1. **Find duplicates** on a folder with a few hundred duplicates (copies!). Select all, then **Delete**.
2. Within a couple of seconds, click **Stop deleting**.

**Expect:**
- [ ] The button shows "Deleting X of Y…", then "Stopping…".
- [ ] The Done screen title is **"Stopped"**, and the remaining files are listed as "Cancelled — not deleted".
- [ ] Those remaining files are still on disk.

## 7. Safety refusals

- [ ] Find duplicates: `Z:\dff-real` plus `Z:\dff-real\backup` marked **Keep** (the Keep folder is inside the other). The scan **runs**, and nothing under `backup` is deletable.
- [ ] Swap which one is Keep. The scan is **refused** with a red message explaining why.
- [ ] Compare folders: Original = `\\192.168.0.101\public\dff-real`, Copy = `Z:\dff-real` (the same folder through two paths). The scan is **refused**.

## 8. Big scan, responsiveness

Run **Find duplicates** on a large folder, such as your whole photo library (scanning only reads files).

- [ ] The window stays responsive during the scan, and you can switch sidebar sections and come back.
- [ ] Results start **collapsed** when there are many groups, and show **"Show 200 more…"** at the bottom.
- [ ] Ticking a file and searching both feel instant.

Note how many files were scanned and how long it took: ______

## 9. Home screen details

- [ ] **Drag a folder** from Explorer onto a drop zone, and it's added.
- [ ] **Locations** opens the drive list quickly, listing your drives and `\\192.168.0.101\public (Z:)`, without freezing the window.
- [ ] Dropping a file **outside** a drop zone does nothing; the app page stays put.

## 10. Settings that should persist

- [ ] Sidebar → **Exclusions**: add `*.tmp`. Close the app and start it again, and it's still there.
- [ ] The Home options summary shows the exclusion count.
- [ ] A folder you own named `Windows` (say `D:\dff-real\Windows`) **is** scanned; only `C:\Windows` is skipped.
- [ ] **Settings → Scan cache** shows "N files remembered" after a scan. **Clear** empties it.
- [ ] Scan options (types, size, confidence) are remembered after a restart, and Compare folders keeps its own confidence setting.

## 11. Odds and ends

- [ ] **Scan options → include empty files**: Results lists the 0-byte files separately ("listed for reference, not deleted").
- [ ] Light theme: starting the app doesn't flash dark.
- [ ] **History**: recent scans are listed, and clicking one reloads its folders.

---

## Report back

Paste this back with your notes (fails only, or anything that felt off):

```
Test | Pass/Fail | Notes (what you saw, what you expected)
0    |           |
1    |           | scan time:
2    |           |
3    |           |
4    |           |
5    |           |
6    |           |
7    |           |
8    |           | files / time:
9    |           |
10   |           |
11   |           |
Terminal output around any failure:
```

Clean up afterwards: delete `D:\dff-real`, `Z:\dff-real` and `Z:\.dff-quarantine`, and empty the Recycle Bin.
