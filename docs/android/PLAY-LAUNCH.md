# Espresso Dial-In Google Play launch preparation

Status as of 18 November 2026. Draft for owner review. The audited build is Android debug v4.15.6 (5), source `00ed0b6acacf9ec10602b1c99ec60b6af171bd98`. A Play release artifact and Play Console record are still pending.

## Store listing draft

| Field | Proposed value |
| --- | --- |
| App name | Espresso Dial-In |
| Type and category | App · Food and Drink |
| Short description | Log espresso shots, track beans, and dial in your grind with local history. |
| Support email | TullLabs@outlook.com, the current in-app feedback address. Confirm it is approved for public support. |
| Package ID | `com.jimbook.espressodialin`. Confirm availability and the permanent ID in Play Console before the first upload. |

Google Play allows 30 characters for the app name, 80 for the short description and 4,000 for the full description. [Listing requirements](https://support.google.com/googleplay/android-developer/answer/9859152) · [Categories and tags](https://support.google.com/googleplay/android-developer/answer/9859673)

### Full description

Espresso Dial-In helps you make sense of each shot and choose what to change for the next one. Log your dose, yield, time and grind setting, then use your tasting notes and shot history to guide adjustments.

- Manage beans and recipes, record tasting notes, and compare shots over time.
- Use grinder suggestions informed by your previous shots. Save favourites and set a bean reference to compare against later shots.
- Review saved shot measurements and available curves in Shot Profile. Log manually whenever you prefer.
- Keep your history on the device. Export a full backup to a file that you control, and review and verify a restore on Android.
- Export individual shot data as JSON or CSV. Share a shot summary as an image, or export SEP CSV from eligible sensor recordings.

During beta you can preview and voluntarily share a problem report or a selected shot contribution. Espresso Dial-In works without an app account.

### Assets and capture plan

| Asset | Requirements and plan |
| --- | --- |
| Play icon | 512 × 512, 32-bit PNG with alpha, at most 1,024 KB. Start with the existing `public/icon-512.png`, verified at 512 × 512 with alpha and 33,461 bytes, or render from `public/icon.svg`. Check its appearance with Play's mask. Existing adaptive launcher mipmaps remain the app icon resources. |
| Feature graphic | 1,024 × 500, JPEG or 24-bit PNG without alpha. Reuse `public/logo-master.svg` or `public/logo-header-dark.svg` and the existing palette. Leave room for cropping and keep key elements central. Finished artwork and owner approval are pending. |
| Screenshots | At least two across supported device types to publish the listing. Capture four phone screens from the candidate in portrait at 1,080 × 1,920 or another compliant size. Files must be JPEG or 24-bit PNG without alpha, each dimension 320–3,840 px, and the long edge at most twice the short edge. Use a 9:16 capture viewport if the Galaxy's native screenshot exceeds the ratio limit. |

Capture Dial with manual entry, Beans and recipe settings, History → Shot Profile with a reference, and Stats or Transfer & Backup. Use an isolated profile with manual test records or owner-approved records. Remove identifying names, notes, emails, device names, addresses and notifications. Use actual application screens. Camera and scale screenshots and hardware claims require physical acceptance first. Prepare genuine screenshots for additional form factors only when supported. [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151) · [Play icon specification](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)

## Testing tracks and onboarding

1. **Internal testing.** After authorization, use the intended Play developer account and confirm identity, contact and any device verification requirements. Check package registration and invite a small named tester list in Play Console, up to 100 internal testers. Provide the Google Play opt-in link and release notes. Internal testing alone does not satisfy the closed-test production rule. [Testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334) · [Account verification](https://support.google.com/googleplay/android-developer/answer/10841920) · [Device verification](https://support.google.com/googleplay/android-developer/answer/14316361)
2. **Closed testing.** Complete app setup and the applicable App content and Data Safety requirements. For personal developer accounts created after 13 November 2023, at least 12 testers must remain opted into the closed test continuously for at least 14 days before the owner applies for production access. Record tester engagement, fixes and readiness evidence for the application. Testers switching from internal to closed must opt out of internal and opt in to closed. Confirm the rule against the actual account and use the account's Console status as evidence. [Production access for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465) · [Switching testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334)
3. **Tester onboarding.** Use the invited Google account and matching opt-in link on a separate test device with no existing debug installation. Verify version and code from the release notes, start with manual logging, reopen a saved shot after a cold launch, and try test-file backup/restore, diagnostics and sharing. Report the build SHA, phone/Android version, steps and outcome using **Settings → Report a problem** or the support email. Sharing and contributions are voluntary. Existing debug users should follow the signing transition plan before changing installations. [Galaxy acceptance checklist](V4.15.5-BETA-ACCEPTANCE.md) · [Debug-to-Play transition](PLAY-SIGNING.md#protect-existing-android-data)

## Versioning and tester release notes

Use the next approved unused Android version code above the local and Play upload ledgers, keep the semantic version consistent across package metadata, and add user-facing notes for every beta, including rebuilds shared with testers. See the [version ledger and reusable release checklist](PLAY-SIGNING.md#reusable-release-checklist).

Draft notes for the first internal build. Fill the actual version and code and recheck the PNG and hardware status before use.

> First Espresso Dial-In Android beta. Log shots, manage beans, compare your history, and try local backup and restore. The build includes a fix for empty PNG exports. Please test saving and sharing a PNG and report the result. Camera and scale compatibility are still being tested. If you already use the debug app, keep it installed and follow the backup instructions before moving to the Play build.

Google Play allows up to 500 Unicode characters per language for release notes. [Release preparation](https://support.google.com/googleplay/android-developer/answer/9859348)

## Readiness and ownership

| Owner | Remaining work |
| --- | --- |
| Codex, local preparation | Listing copy, audit, privacy draft, Data Safety worksheet and release/signing runbook are prepared. After the owner approves the policy URL and analytics decision, add an Android-accessible policy link or text as needed and verify the actual release build's data flows. Prepare screenshots and graphic at the approved capture scope. |
| Owner | Confirm developer name, account type and creation date, permanent package ID, support/privacy contact, hosting URL, retention periods and deletion process, analytics policy, audience, pricing and tester cohort. Choose upload-key custodian and backup location. Authorize any later Console action and any installation replacement separately. |
| Physical hardware | Complete the v4.15.6 PNG retest, Flair 58 and native BLE acceptance, and independent restore rehearsal. Obtain release-candidate WebView network evidence and verify Play-delivered behavior on a separate device once authorized. |
| Play Console | Complete account and package verification, choose Play App Signing, confirm the version-code ledger and app content requirements, set up the private tester list, and verify the Play signing certificate and generated APK. Add any policy declarations only after owner review and explicit authorization. |

The first internal candidate still needs owner and signing approval, the protected restore path, a verified signed AAB and resolved release-blocking device results. A Play-ready privacy policy needs an approved public URL and an in-app link or text. The Data Safety form is exempt while the app is exclusively on the internal track. Prepare the reviewed declaration before moving to closed testing. [Data Safety form scope](https://support.google.com/googleplay/android-developer/answer/10787469) · [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
