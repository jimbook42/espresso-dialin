# Android signing, transition and release checklist

Status as of 25 November 2026. The current local test artifact is the locally signed v4.15.8 debug APK for Galaxy S23 Ultra acceptance. The release variant has no checked-in signing configuration. A signed release AAB, keys and Play-generated APK are pending.

## Signing identities

| Certificate | What it signs | Evidence or planned action |
| --- | --- | --- |
| Existing local debug | The debug APK installed on the owner's Galaxy and the v4.15.x in-place debug updates. | SHA-256 `eed6f6abf590d5e6beaf41fab7c047c0ad82bff78528e67e30f3172b0fe5e44a`. Preserve the existing identity and debug artifact for recovery. |
| Separate upload | The signed release AAB sent to Google Play. | Owner creates and holds it. Record its public certificate SHA-256. Google can authorize an upload-key reset without replacing the Play app-signing key. |
| Play app signing | The APKs delivered to devices by Google Play, including through the internal test track. | Recommend Google's generated key if the owner has no approved cross-store signing requirement. Record the Play Console app-signing fingerprint and verify it against a Play-generated APK. |

The debug and eventual Play app-signing certificates differ. The same package ID with a different signing certificate cannot update the existing debug installation in place. The upload certificate does not solve that conflict. Treat the package ID and Play key choice as long-lived decisions. [Sign your app](https://developer.android.com/studio/publish/app-signing) · [Play App Signing in Console](https://support.google.com/googleplay/android-developer/answer/9842756)

### Owner-led key setup after approval

1. Choose the key custodian, an encrypted vault or drive outside the repository, and an owner-approved recovery location. Use Android Studio's **Build → Generate Signed Bundle / APK → Android App Bundle → Create new** flow for a new upload keystore. Use a strong generated password, a recognizable alias and a certificate valid for at least 25 years. Enter the owner-approved certificate identity. Keep the keystore and password out of project properties, shell commands, source files, logs and chat.
2. Store the keystore in protected primary storage plus a separate encrypted recovery copy with limited access. Store the password separately in an approved password manager. Document who can recover it and test opening the recovery copy and matching the certificate fingerprint. Record only the public certificate SHA-256, alias when appropriate, custodian and storage reference in release notes. A public upload certificate can be exported from Android Studio or with `keytool -exportcert -rfc -keystore <protected-upload-keystore> -alias <upload-alias> -file <public-upload-certificate.pem>`. Let the tool prompt for the password.
3. In the authorized Play Console app, confirm `com.jimbook.espressodialin` has the intended registration and verify the public publisher/contact details. On the Play App Signing setup for the first release, choose the approved app-signing key option. Establish the upload cert with the upload-signed bundle and record both public fingerprints under App integrity. Check Android developer verification and registration status in Console, including if any non-Play distribution is later intended. [Android developer verification and registration](https://developer.android.com/developer-verification/guides/faq)

## Protect existing Android data

1. **Keep the owner's Galaxy debug installation.** Also keep the original Chrome PWA. Finish any current shot, close other sessions that could change the data, and record counts or representative entries for shots, beans, recipes, settings and the latest replay where present. The Android manifest disables Android backup. Use the app's external archive rather than relying on OS restore.
2. In the current debug app open **Settings → Transfer & Backup → Export entire app**. Save a complete `.dialinbackup` in on-device Downloads. Copy it outside app storage to the owner's protected PC storage and keep a second protected copy. Record file length, SHA-256 and export time. Compare the copies. The digest detects copy changes. Verification after actual restore is the acceptance gate.
3. **Rehearse independently while the owner keeps their original app.** On a separate disposable Android device or emulator, import that exact protected copy with a known compatible build and review the preview before confirming. Run **Verify imported data** and record PASS for all six datasets. Check counts, representative old/new shots, curves, notes, preferences, references and available replay, then force-stop, reopen and reverify. Use owner authorization for even a local rehearsal with real data. Keep the AAB install test on a separate device. Another profile on the same phone may share the package and signing constraint, so it is unsuitable as the isolation guarantee. [Full backup and restore procedure](FULL-APP-TRANSFER.md)
4. When an authorized internal build becomes available, verify its Play-delivered certificate and rehearse install, import and force-stop/relaunch on the separate device. Confirm it can restore the same backup format. Any error, missing record or data-integrity mismatch blocks transition.
5. The owner can keep running debug indefinitely during the trial. For a later change to the Play build on the same Galaxy, take a fresh external backup from the current debug installation and independently verify that exact file. Review the results and explicitly authorize any uninstall or replacement separately. Keep the verified copies available, then install from the authorized Play track, import, verify, and check the migrated data after relaunch. Camera and Nearby Devices grants and the scale pairing are granted again. If the Play restore fails, keep the external backup and investigate on the separate test device. The compatible debug APK and verified archive are the recovery option, subject to the owner's authorization for any reinstall.

Backup email is unnecessary. Treat the archive as sensitive and keep the rehearsal environment and copies under the owner's control.

## Build and verify the first release AAB

The checked-in package is `com.jimbook.espressodialin`. Source and the debug artifact show min API 24 and target/compile API 36. The wrapper is Gradle 8.14.3 with AGP 8.13.0. The existing APK ZIP contains two WebAssembly files and zero native `.so` entries. Inspect the actual release bundle and generated APKs for native dependencies and 16 KB page-size compatibility before rollout. [Target API policy](https://support.google.com/googleplay/android-developer/answer/11926878) · [16 KB compatibility](https://developer.android.com/guide/practices/page-sizes)

1. On an approved clean release commit, reserve the version code, record the full Git SHA, Node/npm, JDK 21, SDK and Gradle wrapper versions, and use `npm ci`. Run the automated checks and local production preflight with the correct embedded SHA and hardware flags. Run `npm run android:sync` from that commit. It bundles assets locally with camera and scale enabled and development simulation/replay off. Confirm the sync left tracked source clean.
2. In Android Studio, open `android` and use **Build → Generate Signed Bundle / APK → Android App Bundle**. Select the release variant, protected upload keystore and alias. Enter credentials interactively and use a destination outside the repository. Keep credentials out of Gradle source. Alternatively, build an unsigned AAB with `android\gradlew.bat -p android :app:bundleRelease`, locate it under `android/app/build/outputs/bundle/release/`, and sign a separate copy with `jarsigner -keystore <protected-upload-keystore> -signedjar <signed.aab> <unsigned.aab> <upload-alias>`. Let the tool prompt for credentials.
3. Verify `jarsigner -verify -verbose -certs <bundle.aab>` succeeds and compare `keytool -printcert -jarfile <bundle.aab>` with the approved upload certificate. A self-signed certificate warning can be expected for the upload key. Use `bundletool validate --bundle=<bundle.aab>` and `bundletool dump manifest --bundle=<bundle.aab> --module=base`. Check package, version name/code, min/target SDK, release debuggability, merged permissions and features. Check the packaged web assets match sync, and that the application and diagnostic build metadata contain the exact final commit SHA. Record the bundle's SHA-256 with `Get-FileHash -Algorithm SHA256 <bundle.aab>`. [Bundletool](https://developer.android.com/tools/bundletool)
4. Test a release distribution equivalent on a separate test environment. Verify startup with and without network, privacy policy access, WebView requests with analytics default/imported and off, restore, PNG, diagnostics, contributions, and camera/BLE permissions. Keep these results separate from debug and physical hardware evidence. After the owner authorizes a Play upload, use internal testing, inspect generated APKs in App Bundle Explorer, verify the Play app-signing certificate with `apksigner verify --print-certs` and run the onboarding and independent Play restore checks before touching the owner's installation.

## Version-code ledger

| Local Android version name | Code | Status |
| --- | ---: | --- |
| 4.15.2 | 1 | Debug POC |
| 4.15.3 | 2 | Debug migration |
| 4.15.4 | 3 | Debug historical transfer |
| 4.15.5 | 4 | Debug beta acceptance |
| 4.15.6 | 5 | Debug PNG fix |
| 4.15.7 | 6 | Debug Galaxy acceptance build. Device testing pending. |
| 4.15.8 | 7 | Debug Galaxy S23 Ultra acceptance build. Device testing pending. |
| First Play internal candidate | Next approved unused code above 7 and every prior Play upload | Unassigned. Confirm the actual Console ledger first. |

### v4.15.7 local debug acceptance artifact

- Built 24 November 2026 from `cd10ac4fa584b51567ac97ae9419990ea84d1c83`, the version-only successor of approved source `0d85470c746528693f84d860767b38d62dd708f8`. The APK embeds the version commit. This ledger entry was committed after checksum verification.
- Local Windows artifact `D:\EspressoAndroidToolchain\espresso-dial-in-v4.15.7-debug.apk` (19,216,941 bytes). APK SHA-256 `c099255ac2013e1b485d46fdfdebde5c0116e43855fc227c6d8d8a5e514faca9`.
- Package `com.jimbook.espressodialin`, versionName `4.15.7`, versionCode `6`, min API 24, target API 36. Signer SHA-256 `eed6f6abf590d5e6beaf41fab7c047c0ad82bff78528e67e30f3172b0fe5e44a` matches v4.15.6 (5). The package and signing match support an in-place update after the owner retains an external `.dialinbackup`.
- Release preflight, Capacitor sync, 149 focused Vitest tests, four browser checks, six Android host tests, Java compilation, and debug assembly passed. The APK signature, alignment, archive CRCs, 44 packaged web files, and embedded version and source SHA were verified. The instrumentation test compiled and awaits device execution. Physical acceptance and Play delivery remain pending.

### v4.15.8 local debug acceptance artifact

- Built 25 November 2026 from `0c2f6f18911f1e15df7cce8783eb6d443200b2ce`. This version-only commit follows the PM-approved functional source `3699cdf873ad5aaebe60af0f750fc73fe1d60a55`. The APK embeds the version commit. This ledger entry follows it on the feature branch.
- Local Windows artifact `D:\EspressoAndroidToolchain\espresso-dial-in-v4.15.8-debug.apk` (19,219,565 bytes). APK SHA-256 `310681ba6cb6f06fb963d5d971b9b14048272d9a5d5ce29132a4542a1d85c8af`.
- Package `com.jimbook.espressodialin`, versionName `4.15.8`, versionCode `7`, min API 24, target API 36. Code 7 was unused in the local ledger and existing APKs, and exceeds v4.15.7's code 6. Both APKs verified with signer SHA-256 `eed6f6abf590d5e6beaf41fab7c047c0ad82bff78528e67e30f3172b0fe5e44a`. The package, signing key and WebView origin match the previous build and support an in-place update after the owner verifies an external `.dialinbackup`.
- Release preflight, production web build, Capacitor sync, Android Java compilation, six Android host tests, 182 focused Vitest tests, Android History browser acceptance, and debug assembly passed. Signature, alignment, ZIP CRCs, embedded provenance and all 44 packaged web files were verified. The first packaging attempt stopped on a Windows-locked Gradle cache. A fresh intermediates directory produced the single APK.
- Physical Galaxy S23 Ultra acceptance is pending. There was no installation, production deployment or Play submission.

Record track, versionName/code, full SHA, certificate fingerprints and artifact digest before any upload. Once used for a Play upload, a code cannot be reused. Assign a higher code to replacement builds, including fixes on test tracks. [Version your app](https://developer.android.com/studio/publish/versioning)

## Reusable release checklist

- [ ] Owner approves the scope, release track, permanent package ID, signed candidate and tester cohort.
- [ ] Source is clean and SHA, version name and version code match the approved record. Build is release variant with the intended permissions, policy access, flags and analytics behavior.
- [ ] Run and record Vitest, legacy tests, changed-file lint, production preflight, Android sync, Android host tests and AAB validation. Link browser and hardware smoke artifacts. Record existing lint failures and conditional skips separately when present.
- [ ] Validate the release AAB and its checksum and upload signature. Record separate debug, upload and Play certificate fingerprints. Verify Play-delivered signing on the internal track.
- [ ] Export and verify an external `.dialinbackup` and independently rehearse restoration before any signing transition. Preserve the owner's debug install until both gates pass and any replacement is explicitly authorized.
- [ ] Record real Flair 58 and BLE acceptance and external-recipient PNG sharing separately from the verified v4.15.6 Galaxy PNG download. Verify on-device Android WebView traffic with a clean profile and one with an imported analytics-enabled preference.
- [ ] On a separate device, install the first authorized internal-track build from Play, save test data, then update from Play to a subsequent higher-code build. Verify the on-device signing certificate and check that the shots and settings survived. Record both builds and outcomes.
- [ ] Review listing, devices, privacy policy and Data Safety or applicable internal-only exemption against the candidate. Verify the approved policy URL in a signed-out browser and from Android Settings on a physical candidate. Confirm the support contact and manual retention/deletion process work. [Privacy hosting and operations](PLAY-PRIVACY-OPERATIONS.md)
- [ ] Include **user-facing release notes for every Android beta build**, including fixes distributed to the same testers. State version/code, visible changes, known issues, safe update guidance and the feedback route. For Google Play, respect the per-language limit in the [release guidance](https://support.google.com/googleplay/android-developer/answer/9859348).
- [ ] Complete the internal record below, link it to the source SHA, and file it with the release before distribution.

```text
VersionName / versionCode:
Track / release date:
Full Git SHA and release notes location:
Artifact location and SHA-256:
Package / min, target and compile SDK:
Signing identity and public certificate SHA-256 (debug, upload, or Play):
Toolchain and locked dependencies:
Automated tests / pass, fail, skips / lint findings:
Emulator and physical device results (device, Android, hardware):
Backup/restore and test update evidence:
Privacy / Data Safety / permissions / analytics checks:
Known issues, blockers and owner approval:
```
