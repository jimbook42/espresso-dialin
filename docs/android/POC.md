# Android POC: scaffold status and release preparation

This branch is an incomplete engineering scaffold, not a beta candidate. The Android project bundles the existing React app. The native BLE plugin is installed but is not wired to the scale transports; Web Bluetooth remains the only scale implementation. Automatic reconnection is not implemented. Camera permission handling and the WebView camera workflow have not been implemented or tested. Do not use this build to assess hardware support or publish it.

## Build

Install Node dependencies with `npm ci`, then install Android Studio and the Android SDK required by Capacitor 8 (compile/target SDK 36, minimum Android 7/API 24). From the repo root, run `npm run android:sync`. This builds the PWA assets with pressure lab and scale enabled and simulator/replay flags disabled, then copies them into the Android project. Open `android` in Android Studio, let Gradle sync, and build a debug APK. Alternatively, with the Android SDK and Java configured, run `android\gradlew.bat -p android assembleDebug` on Windows. The expected APK is `android/app/build/outputs/apk/debug/app-debug.apk`. No SDK or device was available when this document was written.

The Android app uses separate WebView storage from the Chrome PWA. History does not transfer automatically. Keep the original PWA and its data. Before any migration, export a full portable backup using the existing Settings backup control and retain a second copy outside both apps. Restore only after the Android import flow is verified on a disposable installation; confirm beans, shots, settings, links and curves against the source before trusting it. Do not delete PWA data. CSV export/import is not a guaranteed lossless full backup. Native file picker, export and restore must be tested first; this scaffold does not establish a proven migration route.

## Beta preparation (not publication)

The provisional application ID is `com.jimbook.espressodialin`; verify ownership and choose the final permanent ID before the first Play upload. Android `versionName` starts at 4.15.2 to match the web source; `versionCode` starts at 1. Assign a unique integer greater than every prior Play upload for every AAB, including internal tests. Track code, name, commit SHA, tester notes and build date together. Never reuse a code. Keep `package.json` version changes subject to the repository's release instructions.

For each beta, build from a clean, reviewed commit and record its full Git SHA (`git rev-parse HEAD`), Node and npm versions, lockfile, Android Studio/JDK/SDK versions and Gradle wrapper. Run `npm ci` and `npm run android:sync`; use Android Studio's Build > Generate Signed Bundle / APK > Android App Bundle. Select the protected upload keystore and alias via the IDE prompts; use the release variant. The resulting AAB is under `android/app/release/`. This procedure has not been exercised here and byte-for-byte reproducibility is not established.

Create the upload key in a secure location outside the repository using Android Studio's key creation flow. Store the keystore and recovery copies in approved encrypted storage, keep passwords separately in a password manager, restrict access, and never place secrets in Git, command lines, logs or tickets. Use Play App Signing and retain a protected upload-key recovery procedure. `.jks`, `.keystore`, `.p12`, and `.pfx` files are ignored as a safeguard, not a substitute for checking staged files.

Before any internal or closed test, verify the final package ID, signing, version code, privacy/data-safety disclosures and current Play requirements; create the app and tester list only with authorization. Add release notes for every beta build from the template below, and link the internal record to the exact Git SHA. This document does not authorize a Play upload or rollout.

## User-facing release notes template (required for every beta)

```text
Espresso Dial-In Android beta <version name> (<version code>)

What's new
- <User-visible changes>

Known issues
- <Specific issues and workarounds>

Testing requested
- <Actions testers should try and how to report results>
```

## Internal technical changelog template

```text
Version name / code:
Full Git SHA:
Build date and toolchain:
Changes:
Automated checks and results:
Emulator/device checks and results:
Known limitations and risks:
Release notes location:
AAB checksum and artifact location:
```
