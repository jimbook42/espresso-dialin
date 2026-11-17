# Beta diagnostics, contributions and interoperability

## Reporting a problem

Use **Settings → Report a problem** at any time. **Shot Profile → Share diagnostic report** can also include detailed evidence for that shot when selected. Review the exact JSON, add a description if useful, then tick the consent box. Choose **Share file** or **Save file**. The Android chooser lets the tester choose the recipient. For email clients that support it, the tester can suggest `TullLabs@outlook.com`. Alternatively, save the file, open **Email developer** and attach it manually. Inspect the attachment and recipient before sending. A chooser or draft gives no delivery confirmation.

The local event history is capped at 120 entries or seven days and pruned on access. It stores a small set of event codes and JavaScript error classes. Reports use event ages, build metadata, platform, Android release where available, and summary counts from available shot-device evidence. Error messages, URLs, stack traces, device identifiers, notes, samples and images are excluded by default. Device model and detailed shot diagnostics are separate choices. The detailed attachment can expose saved shot IDs, notes and samples, so review it before sharing. **Clear local event history** clears the rolling log. The log is separate from the full-app backup archive. On a browser that denies local storage, the history is held in memory for the current session.

## Contribution format v1

Use **Shot Profile → Contribute shot data** for one shot, or **Settings → Contribute shot data** to choose multiple shots or all eligible records. Early and incomplete saved shots are eligible. The workflow previews the exact JSON before consent. Files larger than 8 MiB at export must be split into smaller selections.

The top-level JSON includes `format: "espresso-dial-in/beta-contribution"`, `version: 1`, `dataCompatibilityVersion: 1`, a random `exportId`, UTC `exportedAt`, `exportBuild` with app version and full Git SHA, an optional tester alias, and `records`. Use an alias other than a real name, address or email.

| Record section | Contents |
| --- | --- |
| `measurements` | Dose and yield in grams, shot and recorded extraction duration in seconds, computed ratio. Each has a value and its own provenance. |
| `grinder`, `preparation`, `bean` | Recognized grinder model and saved dial settings including safe custom dial values, curated machine/method when recorded, Flair preparation fields, configured targets, roast, decaf, storage and effective bean age when available. |
| `feedback`, `recommendation` | Structured taste and rating, learning exclusion, saved next-shot recommendation, any recorded previous recommendation follow-through, reported versions when saved, estimated sensitivity flag when known. |
| `sensors` | Pressure and weight points in their recorded clocks, observed point indices, gaps, any relative clock alignment evidence and calculated flow intervals between contiguous weight samples. |
| `quality` | Missing main measurements, completeness, validity of the original saved timestamp, inconsistent relative timing, and pressure/weight gap counts. |
| `contentSha256`, `possibleDuplicateInFile` | SHA-256 of the canonical projected record before these two fields, and whether the fingerprint already occurred in this file. |

Unknown values use `null` or an explicit `unknown`/ `unavailable` provenance. An actual saved zero remains zero. Physical camera/BLE evidence is labelled by source. An explicitly simulated curve is omitted and labelled `simulation-excluded`. Saved observations that predate source recording remain `unknown`. Calculated values and estimated sensitivity remain distinguishable from observations. Pressure and weight gaps remain visible and flow never bridges them. The export timestamp describes the file, while shot timing uses relative clocks. Historical Android records can carry the old Web Bluetooth label and those records retain it. Existing records often lack an algorithm version or the exact recommendation previously shown. The export build and saved next-shot recommendation remain separately labelled.

The full backup, portable shot exports, and contributions serve separate purposes. A contribution omits raw saved shot and bean IDs, original shot timestamps, custom grinder names, private notes, device addresses, images, videos and personal settings. The optional tester alias and user-written problem description should be reviewed like any data entered for sharing.

### Offline review and recommendation tests

1. Run `node scripts/validate-beta-contribution.mjs path/to/file.json` with Node 22 or newer. Validation checks the supported version, structure, bounded file size, record digests and within-file duplicate flags. Verify the source through the person who sent the file.
2. Store reviewed files in a restricted research directory outside Git and the personal app database. Record the decision to accept or quarantine a file and the review date. Check for unusual field combinations and privacy surprises before using the records.
3. Compare across files by `contentSha256` and retain a source export ID list for audit. Identical projected records can occur legitimately. A later edit or different enrichment can produce different digests for the same shot. Verify potential duplicates before dropping them.
4. Assemble an offline dataset of accepted rows, keeping the quality and source fields. Group by available hardware, recording provenance and known build identifiers. Keep unknown history and incomplete records identifiable. Exclude unknown, simulated, or unaligned signals from tests that require verified measured inputs.
5. Use an offline copy for reproducible recommendation evaluation or pressure/flow analysis. Keep a held-out set and track acceptance criteria and source build. Tester files remain outside personal shot history and never trigger automatic model changes.

## Cross-app interoperability

| Capability | Status |
| --- | --- |
| File export | Portable shot JSON, legacy shot summary CSV and SEP CSV for eligible sensor data. SEP pairs require valid relative alignment. SEP keeps observed timestamps and values and leaves gaps unfilled. Portable JSON retains explicit gap markers. |
| Android Share sheet | **Share to compatible app (SEP CSV)** offers the generated file to installed receivers. **Export SEP CSV** saves locally. Receiver availability and actual attachment delivery require phone testing. |
| Direct app-to-app import | Beanconqueror documents `ADD_BREW` and `ADD_BREWS` custom-scheme deep links using a gzip/Base64URL payload. Required actual water input in mL, beverage output, brew date/time and preparation method must be present. The Dial logger does not capture water input. Beverage yield is a distinct measurement. The existing converter can encode a record only if the necessary documented fields are already present. Its contract test supplies those fields. No direct action is exposed, and a generic import route for Dial portable JSON or SEP CSV was not established. |
| Visualizer and other SEP applications | Visualizer has a SEP CSV parser and authenticated upload endpoint. Use file export and the receiver’s supported import path. Its parser can resample and compute flow, so compare the receiver graph with the source CSV during acceptance. Other receivers need their own contract and device tests. OAuth/upload is separate work. |

Primary contracts and fixture references are available from [Beanconqueror's brew import documentation](https://github.com/graphefruit/Beanconqueror/blob/develop/docs/brew-import-api.md), [Visualizer's SEP parser](https://github.com/miharekar/visualizer/blob/main/app/models/parsers/sep_csv.rb), [Visualizer's API documentation](https://apidocs.visualizer.coffee/) and [Android's file sharing guidance](https://developer.android.com/training/sharing/send). See also [B13 portable exports](../b13-portable-exports.md).
