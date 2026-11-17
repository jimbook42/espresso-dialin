# Full app transfer from the PWA to Android

The source is **https://espresso-dialin-puce.vercel.app**. Browser storage belongs to this origin. A preview deployment or a different domain cannot export the existing Chrome installation's data. The production alias must serve an approved exporter build before migrating real data. Keep the original PWA and its storage throughout the transfer.

## Persistence coverage

| Store | Coverage |
| --- | --- |
| `EspressoDialDB.beans` | All rows and fields, including unused, frozen, thawed and finished beans, IDs, names, roast and storage information, dates, and ratings. |
| `EspressoDialDB.recipes` | All rows, original recipe and bean IDs, dose, yield, time and temperature targets, and Flair profiles. |
| `EspressoDialDB.shots` | All rows, including standalone Pressure Tracker recordings, stable IDs, timestamps, linked beans and grinder details, recipe/target context, measurements, timing, notes, taste, ratings and learning exclusions. Preserves pressure, weight and flow samples, gaps, diagnostics embedded in records, and saved gauge JPEG data URLs. Fields unknown to the exporter are retained when they use supported stored types. |
| `EspressoDialDB.settings` | All rows, including `global` and `history-shot-selections` (ordered favourites and bean references). Full global row includes grinder model/custom definition and setup draft, `grindUiByBeanGrinder`, latest dial controls, recommendation display holds, grinder offsets, last bean, Flair and Brew Guide setup and accessories, guidance mode, countdown, preinfusion, default experience, theme, layout/metric preferences, stats options and usage preference. Also includes camera enablement, preview, reader selection and gauge calibration, and scale model and auto-stop preferences. Legacy and additional persisted settings fields travel with their row. The inactive `src/db.js` wrapper opens the same database name and declares the same four stores. |
| `EspressoDialLabReplay.lastReplay["last"]` | The complete latest saved replay record, original video Blob and media type, dimensions, timestamps, duration, sample log and extra fields. The app only retains one replay here. If a historical shot has no saved video at export, none is reconstructed. |
| `localStorage` | Explicit allowlist of `espresso-dialin.beans-finished-section-open` and `espresso-dialin.camera-facing-mode`, including whether each is present. The global settings mirror is rebuilt from restored settings or cleared when there is no global row. |
| Device and transient state | The PWA install-prompt dismissal timestamp stays in its own browser. Expiring manual shot drafts, active recording/timer buffers, undo state, uncommitted UI forms, navigation history and the weighing view's session preference are temporary. Finish and save source shots before export. Restore refuses to replace over a destination manual draft. |
| Hardware and browser state | Bluetooth device addresses, browser/OS pairing and permissions, camera permissions, Chrome installation state, service worker/cache files and unrelated browser/site data do not transfer. A fresh Android install needs to pair the preferred scale and request camera permission. A device already remembered by that Android installation stays local to it. Camera settings transfer, but confirm calibration for the current mount and camera. |
| Derived and recovery state | History and Stats are recalculated from restored records. Recommendation outputs are recalculated while saved context, preferences and any display holds are preserved. Transfer recovery journals, saved previous-copy archives, and verification reports stay on the destination and aren't included in exports. The app has no other persistent record store, cookie data, server account or sync store involved in migration. |

## File and verification

The uncompressed `.dialinbackup` v1 archive begins with `DIALIN01`, a four-byte little-endian manifest size, the SHA-256 of that UTF-8 JSON manifest, then the manifest and ordered payloads. The manifest records the format/version, app version, UTC export time, dataset counts, part lengths and digests. Each dataset has one canonical tagged JSON payload followed by any binary parts. Each part digest is SHA-256 over the concatenated SHA-256 digests of consecutive 4 MiB blocks (an empty part has one empty block). Blobs remain binary and keep their MIME types. The codec handles plain records, arrays, undefined, Dates, exact JS numeric values, BigInts, Blobs, Files and ArrayBuffers. Unsupported stored types fail visibly. There is no path extraction or decompression. Checksums detect corruption and confirm equality. The file is unencrypted and checksums do not prove who created it.

The reader checks version, canonical IDs and local preference keys, duplicates, lengths, checksums, asset references, unsafe embedded filenames and trailing bytes. It checks shot/recipe/bean links, shot selections and replay ownership. Existing missing links appear as warnings and are preserved when confirmed. Imported rows keep their IDs. Conflicts are shown in the preview and the confirmed option replaces the supported datasets without merging.

Archives are limited to 512 MiB, with up to 64 MiB of structured data per dataset and a 1 MiB manifest. Video is hashed in blocks. Android export streams the archive to the system file picker in 256 KiB chunks. Select on-device Downloads. A failed write reports the error, and any incomplete file fails import validation. Space is needed for the selected file, the staged copy, the previous Android backup and the restored databases. Browser and Android quotas can be lower than the format limit. Keep extra free space and retain the original backup file. A quota failure while preparing the recovery copies leaves the current data untouched.

On confirmation, Android saves the source archive and previous Android data in the local `EspressoDialTransfer` journal, then reloads. Startup rechecks that the destination has not changed, replaces the four main tables in one transaction and updates replay and preferences. Since these stores cannot share one transaction, startup keeps the app behind a recovery screen until it can finish and read back matching counts and checksums. A failed or interrupted transfer can retry the same copy or recover the previous one. After success, use **Save previous Android backup** to keep the previous snapshot outside the app before a later transfer supersedes it. Verification checks all six datasets. A later edit can make a fresh comparison differ, even after a successful transfer.

## Safe migration order

1. Approve and release the exporter on the existing production origin. Close and reopen the installed PWA after the update and confirm **Settings → Transfer & Backup** is present. Keep the Chrome installation and its data.
2. Finish and save any shot. Close other tabs for the PWA, then select **Export entire app**. Confirm the `.dialinbackup` file exists in Downloads. Make a spare copy if practical.
3. Install the debug APK after approval. If it opens to setup, complete enough of the existing setup to reach Settings. Avoid logging new shots on the destination before the transfer.
4. On Android open **Settings → Transfer & Backup → Import existing app**. Pick the file from on-device Downloads and review dataset counts, changed IDs, removed records and relationship warnings.
5. Confirm the exact copy. Let the app reload. If a recovery screen appears, retry after correcting the problem or recover the previous Android data.
6. Open Settings and run **Verify imported data**. Check History and Stats, representative notes, curves, gauge images and replay, finished beans, grinder settings and the default experience. Force-stop and reopen Android, then repeat verification before making new edits.
7. Pair the scale on Android, grant camera permission and check the gauge calibration. Retain the original PWA and its backup until satisfied.

## Proposed release notes

- Added **Transfer & Backup** in Settings. Export your full Espresso Dial-In history, beans, recipes, settings and latest saved replay to a local file.
- On Android, preview an exact copy, keep a recovery backup and verify the restored data after import.
- Camera and Bluetooth permissions stay with each installation. Pair the scale and grant camera access on Android.
