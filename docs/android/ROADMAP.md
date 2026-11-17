# Espresso Dial-In Android roadmap

Dedicated Android and Google Play roadmap for `feat/capacitor-android-poc`. The starting point is v4.15.4 at `9361daf7775fe2bbac3fdbd4928bf1392a5b4a43`. The existing PWA roadmap continues independently. Android and the PWA use the same React application.

## A1. Android foundation and migration

- **Priority** High.
- **Status** Implemented and automated verified. Device verified for the owner's completed migration of real PWA data to Android, as reported by the owner. Hardware and navigation acceptance are tracked in A5.
- **Dependencies** Capacitor, native BLE plugin, Android WebView, file picker, and compatible debug signing identity for updates. Preserve the existing PWA origin for access to its IndexedDB.
- **Acceptance criteria** Package the existing app for offline startup. Support native BLE, camera, Android Back and file sharing. Verify full-app backup, import and recovery for historical and current records. Verify package ID, version name, incrementing version code, signing and embedded source SHA.
- **Verification evidence** The v4.15.4 release records a signed debug APK and checks for archive v1/v2 and historical schemas 1, 6, 10, 11 and 17. The owner completed the transfer on their phone. The build and migration do not establish camera, scale, or chooser acceptance. [Android POC](POC.md), [v4.15.4 release](V4.15.4-RELEASE.md), [historical audit](HISTORICAL-TRANSFER.md).
- **Next action** Preserve the installed debug app and backup during A5. Finish an Android update and restore rehearsal before choosing the Play onboarding path.

## A2. Beta diagnostics

- **Priority** High.
- **Status** Implemented and automated verified. Device acceptance pending.
- **Dependencies** Existing camera and scale state, shot device diagnostics, build metadata, Capacitor share/save bridge and browser file fallback.
- **Acceptance criteria** Open a report from Settings before saving a shot or attach detailed evidence from Shot Profile. Include version, SHA, Android version, device model by opt-in, recent error classes and app/camera/BLE transitions. Keep a bounded local history through restarts. Require preview and consent before sharing or saving.
- **Verification evidence** Vitest checks retention, restart readback, privacy allowlists and sharing outcomes. The Chromium smoke covers no-shot reports, consent, cancellation and local file download. Android debug Java compilation checks the native bridge.
- **Next action** On the Galaxy, cause a real permission denial and a disconnect, reopen the app, review the report, cancel chooser/save, then send a test attachment to a chosen email client.

## A3. Cross-app interoperability

- **Priority** High.
- **Status** Implemented and automated verified for file export and SEP eligibility. Android receiver acceptance pending. Beanconqueror direct import blocked. Visualizer authenticated upload planned separately.
- **Dependencies** Receiving app and its documented version/format, source sample provenance, and valid time alignment for dual tracks.
- **Acceptance criteria** Keep shot JSON and SEP CSV export. Hand eligible SEP files to the Android chooser. Retain original measured points and preserve time alignment and gaps in the source export. Expose a direct import only for fully valid documented data. Review OAuth and token handling before building authenticated uploads.
- **Verification evidence** Tests compare native BLE and web BLE SEP moments, offsets and gaps. Current Beanconqueror and Visualizer contracts were checked. [Interoperability audit and compatibility table](BETA-DATA.md#cross-app-interoperability).
- **Next action** Import a real Galaxy recording through a compatible SEP receiver and check the graph against the original. Revisit Beanconqueror after there is a reliable recorded water-input field.

## A4. Opt-in beta shot contributions

- **Priority** High.
- **Status** Implemented and automated verified. Device acceptance pending.
- **Dependencies** Saved shots and linked bean data, consent, file sharing, and a separate offline review dataset.
- **Acceptance criteria** Preview and share one, multiple or all saved shots. Include available extraction, grinder, bean, taste, timing and recommendation evidence. Preserve unknown values and sensor provenance. Exclude private free text and media. Provide format compatibility, quality indicators, checksums and possible duplicate flags.
- **Verification evidence** Vitest validates mixed historical/current records, missing measurements and gaps, privacy, simulated sensor exclusion, and cross-export fingerprints. The Chromium smoke checks the selected and all-shot workflow without modifying stored records. [Contribution format and offline workflow](BETA-DATA.md#contribution-format-v1).
- **Next action** Review the first manually submitted file offline and agree on retention and access before recruiting a wider tester group.

## A5. Physical hardware acceptance

- **Priority** High.
- **Status** Blocked on access to the owner's Galaxy S23 Ultra, Flair 58 and the available scales.
- **Dependencies** Owner-approved APK build, confirmed debug signing certificate for in-place update, battery/permission checks, secured copy of a verified backup, and real coffee hardware.
- **Acceptance criteria** On the Galaxy, verify Flair 58 front-camera permission, calibration, tracking and pressure capture against the physical gauge. Check pairing, remembered-scale reconnection on entry to a shot, tare and measured weight, flow and auto-stop for each available Timemore, Acaia or Bookoo model. Run BLE with the camera active. Test interruption and recovery after backgrounding, screen lock and force-stop. Check saved shots, diagnostics and verification after relaunch. Run an offline startup, Android Back, orientation and actual chooser/saved-file exercise.
- **Verification evidence** Owner migration is recorded in A1. Simulations, fixture results and Gradle compilation provide regression evidence only. Record phone/OS/build SHA, hardware and firmware, actual observations and any unsupported device separately.
- **Next action** Retest the v4.15.6 PNG fix on the Galaxy S23 Ultra. During v4.15.5 acceptance, the owner reported an empty file from **History → Shot Profile → Share Shot → Download PNG**. Whether it contained zero bytes or decoded as a blank image was undetermined. This blocks release until both Download PNG and Share PNG produce viewable images with complete bytes on the phone. Exercise cancellation and repeat with a sensor shot and a bean reference. [Galaxy acceptance checklist](V4.15.5-BETA-ACCEPTANCE.md).

## A6. Google Play preparation

- **Priority** Medium.
- **Status** Planned. Listing and policy work can proceed alongside A5.
- **Dependencies** Play developer account details, branding assets, secure signing, runtime-permission inventory, existing analytics review and A5 gate before wider distribution.
- **Acceptance criteria** Draft the listing, current screenshots, privacy policy and support contact. Review Data Safety for existing behavior and third-party SDKs as well as voluntary files shared with chosen recipients. Document camera and nearby-device permission purposes. Check current target API and other Play policies at submission. Rehearse a clean-commit AAB build, Play App Signing and a separately managed upload key, then verify the delivered signing certificate and update path. Track every release by monotonically increasing version code, commit SHA and tester-facing release notes. Prepare internal testing.
- **Verification evidence** The debug POC records its package ID and debug signing process. The release AAB, Play-delivered certificate and real update path remain open. Different signing certificates prevent in-place updates for the same app ID. Preserve a verified local backup, use a separate test install or profile for rehearsal, and validate restore before authorizing any cutover. [Android signing and Play App Signing](https://developer.android.com/studio/publish/app-signing), [internal and closed tracks](https://support.google.com/googleplay/android-developer/answer/9845334).
- **Next action** Confirm account type and creation date, then draft the listing and signing rehearsal checklist. Keep signing keys outside Git.

## A7. Closed beta and production

- **Priority** Medium, after A5 and A6.
- **Status** Planned.
- **Dependencies** Device acceptance, internal-track rehearsal, rollout owner, tester cohort, feedback triage, approved privacy disclosures and a sign-off on diagnostic/contribution retention.
- **Acceptance criteria** Recruit and onboard testers with install/update, backup, consent and feedback instructions. Triage issues by build and device, review contributed files offline and rerun web, native and restore regression checks. Require device, migration, signing, privacy and release-note gates for production. Check the requirements for this Play account before starting the closed test. Newer personal accounts covered by Google's rule need at least 12 testers opted in continuously for 14 days before applying for production access. [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
- **Verification evidence** Tester-ready source workflows and offline format are available in A2 and A4. Track participation, Play access and release decisions when they occur.
- **Next action** Write a short onboarding and regression checklist after A5 and invite the initial cohort only after internal-track acceptance.
