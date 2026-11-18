# Android POC: scaffold status and release preparation

The Android app packages the v4.15.2 React UI, OpenCV, the ONNX model and its runtime locally. Its build enables camera pressure and scale support. It has no development server URL or service worker. The native shell handles Android Back, camera permission, PNG share and save, and saving the portable JSON backup. The screen stays awake while the timer is running or Pressure Tracker is recording.

The smart scale setting and existing Connect control select and validate a device against the configured Timemore, Acaia or Bookoo GATT profile. Android stores the last successfully connected address per scale model locally. After pairing, deliberately enter Dial, Pressure Tracker or Brew Guide to try one direct connection. On a cold launch, tapping the live tab also counts as an explicit entry. An unavailable scale or missing permission leaves manual entry available. Use Connect again for permission, a changed address or a different device. There is no background scan. Reconnection and hardware compatibility require phone and scale testing.

## Build

Install Node dependencies with `npm ci`, then install Android Studio and the Android SDK required by Capacitor 8 (compile/target SDK 36, minimum Android 7/API 24). From the repo root, run `npm run android:sync`. This builds the PWA assets with pressure lab and scale enabled and simulator/replay flags disabled, then copies them into the Android project. Open `android` in Android Studio, let Gradle sync, and build a debug APK. Alternatively, with the Android SDK and Java configured, run `android\gradlew.bat -p android assembleDebug` on Windows. The expected APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Use JDK 21 and the checked-in Gradle wrapper. See the technical changelog for the recorded build and verification results.

Chrome and Android WebView use separate IndexedDB stores. Use [Transfer & Backup](FULL-APP-TRANSFER.md) for a full migration after the exporter is released on the existing Chrome PWA origin. Keep the original Chrome PWA and its data. The original portable shot JSON and CSV controls are still available for shot-level exchange.

## Phone verification

- Install the debug APK on the Galaxy S23 Ultra. Launch in airplane mode, visit Dial, Pressure Tracker, Beans, History and Stats, and compare portrait, landscape and both themes with the Chrome PWA.
- Log a manual test shot, force stop and relaunch, inspect History and Stats, and exercise Back before saving and while overlays are open. Save and share a PNG, then export and restore a small portable JSON backup as described above.
- Grant and deny Nearby Devices. With the actual scale, check pair, weight, tare and timer commands. Restart without entering the workflow, then enter it and check reconnection. Repeat with Bluetooth off, the scale asleep or disconnected during a shot. Check that manual yield still works and that a late connection does not take over the shot.
- Grant and deny camera access. On the original Flair 58, confirm front camera preview, calibration, live pressure sampling, recorded curve and recovery after Home, screen lock and return. Exercise the camera and scale together. Confirm the screen can sleep again after the shot ends.

## Beta preparation (not publication)

For current preparation beyond this POC, use the [Play launch plan](PLAY-LAUNCH.md) and the [signing, migration and release checklist](PLAY-SIGNING.md). Preserve an independently verified full-app archive before any future signing-identity transition.

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

## Proposed tester notes for the POC

This Android build uses the same Espresso Dial-In screens as the web app. Try saving and sharing a test shot, reconnecting your scale after explicitly opening Dial, and using the Flair 58 camera reader. For a complete history transfer use [Transfer & Backup](FULL-APP-TRANSFER.md) and rehearse restore before changing installations. Scale reconnection and the camera reader still need physical verification on the Galaxy S23 Ultra.
