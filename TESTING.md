# Real-world test checklist

A hands-on pass over everything changed in Phases A–D, using your own files. Allow about an hour. Work through it in order, and note anything that looks wrong, reads confusingly or feels slow. Odd wording counts too.

**Safety first:** run every delete test against **copies**. Nothing is ever permanently deleted: files go to the Recycle Bin or to a `.dff-quarantine` folder on the same drive. Still, keep the real originals out of the "Scan target" box until you trust the app.

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

## 1. Verify: is everything backed up?

1. Home → **Verify backup**. Source = `D:\dff-real\originals`, Backup = `Z:\dff-real\backup`.
2. Open **Scan options**. Match confidence should default to **Thorough**, marked Recommended. Start the scan.

**Expect:**
- [ ] The headline says **"⚠ 4 source files are not in the backup"**: the 3 deleted plus the edited one, since its contents changed.
- [ ] **Missing from the backup** lists exactly those 4 files, RAW files included.
- [ ] The **renamed** file counts as backed up (same contents, different name).
- [ ] **Only in the backup** shows your added file (and the edited version).
- [ ] The sentence under the title names the right two folders.

Note how long the scan took: ______

## 2. Verify, Standard match

Repeat test 1 with **Scan options → Standard**.

- [ ] The card says **"Likely backed up"**, not "Backed up".
- [ ] A note explains that only the first 64 KB were compared.

## 3. Compare, Standard match

1. Home → **Compare locations**. Protected source = `D:\dff-real\originals`, Scan target = `Z:\dff-real\backup`.

**Expect:**
- [ ] The bar and tiles (**Only in source / Duplicates in target / Only in target**) match your changes and add up to the totals at the top.
- [ ] **Folders in the target**: partly matched folders show "X of Y in source", plus how many are not in source and the space you'd free.
- [ ] Tick one folder, then **Review N selected files**. Results opens scoped to that folder, with **only** its matched files ticked.
- [ ] In that scoped view, **Auto-select duplicates** doesn't tick files in other folders.
- [ ] No file from `originals` can ever be ticked; it shows a shield instead.

## 4. Compare, Quick match

Repeat test 3 with **Scan options → Quick**.

- [ ] The wording changes to **"name matches"** and "with a same-name match".
- [ ] The **Only in target** tile is greyed out with "needs a standard scan".
- [ ] A note explains that Quick only compares names and sizes.

## 5. Delete from the NAS, then restore

1. From test 3's results, select about 10 files in the **target** (`Z:`), then **Delete**.

**Expect:**
- [ ] The Done screen says the files went to a **.dff-quarantine folder on the same drive** (network drives have no Recycle Bin).
- [ ] `Z:\.dff-quarantine` exists and holds them, along with a `manifest.jsonl`.
- [ ] **Space freed** matches what you deleted.
- [ ] Sidebar → **Quarantine** lists them. **Restore** one, and it reappears at its original path.

## 6. Stop a delete part-way

1. Run a Simple scan on a folder with a few hundred duplicates (copies!). Select all, then **Delete**.
2. Within a couple of seconds, click **Stop deleting**.

**Expect:**
- [ ] The button shows "Deleting X of Y…", then "Stopping…".
- [ ] The Done screen title is **"Stopped"**, and the remaining files are listed as "Cancelled — not deleted".
- [ ] Those remaining files are still on disk.

## 7. Safety refusals

- [ ] Protected source = `Z:\dff-real\backup`, Scan target = `Z:\dff-real` (the target contains the protected folder). The scan **runs**, and nothing under `backup` is deletable.
- [ ] Swap them (the target is inside the protected folder). The scan is **refused** with a red message on Home.
- [ ] Protected source = `\\192.168.0.101\public\dff-real`, Scan target = `Z:\dff-real` (the same folder through two paths). The scan is **refused**.

## 8. Big scan, responsiveness

Run a **Simple scan** on a large folder, such as your whole photo library (scanning only reads files).

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
- [ ] Scan options (types, size, confidence) are remembered after a restart, and Verify keeps its own confidence setting.

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
