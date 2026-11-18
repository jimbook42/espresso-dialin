# Android privacy hosting and manual operations

## Hosting handoff

The [public Android privacy policy](https://jimbook42.github.io/espresso-dialin-privacy/) was published on **18 November 2026**, with the GitHub Pages build completing at **00:56:18 UTC**. The [dedicated public repository](https://github.com/jimbook42/espresso-dialin-privacy) serves branch `main` from its root with HTTPS enforced. The published revision is [`46da6baf244d0b294b599f3d91beb615bc516091`](https://github.com/jimbook42/espresso-dialin-privacy/commit/46da6baf244d0b294b599f3d91beb615bc516091), generated without changes from app revision `12f54a8288757246593053e1904708594b861dde`. The repository contains only `index.html` and `.nojekyll`.

Signed-out HTTPS verification returned HTTP 200 and matched the locally rendered HTML byte for byte. A 320 px Chromium viewport showed the approved Tull Labs identity, mail link and retention periods without horizontal overflow. The page made no secondary requests and contains no analytics scripts. GitHub Pages logs visitor IP addresses for security, as disclosed in the policy. [About GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

For approved future updates, use this process.

1. Build a local review copy from the canonical [Android privacy policy](PRIVACY-POLICY.md). From the repo root in PowerShell 7, run `node scripts/render-android-privacy-policy.mjs > "$env:TEMP\espresso-dialin-privacy.html"`. The renderer produces standalone HTML with no external assets or scripts. Keep the preview outside the app repository and any deployed folders.
2. After separate owner approval, update only the reviewed `index.html` on the policy repository's publishing branch. Keep the public repository limited to the policy page and minimal Pages files. Keep the support mailbox, register, app archives and received attachments in their approved private locations. [Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Verify the exact URL returns the intended policy over HTTPS without signing in, downloading a PDF, or requiring a region or account. Verify its contents and contact link in a signed-out browser. The Settings link is Android-only and uses the existing Capacitor external URL handling. Verify it opens the system browser on a physical release candidate. If the hosting address changes, update the link before distributing the candidate. Use the same URL in Play Console only after approval. [Google Play privacy policy requirements](https://support.google.com/googleplay/android-developer/answer/10144311)
4. For any policy change, update the source Markdown, review the rendered copy and publish only after approval. Track the approved source SHA and the public page revision. Preserve the stable URL.

## Support mailbox and submission deadlines

Set up this manual process before accepting new submissions through Play. Assign a named operator and cover for absences. Keep the register restricted and encrypted. Use Outlook folders or categories to separate diagnostics, contributions and privacy requests. Keep contribution files in a restricted encrypted location outside Git, separate from the owner's shot history, with a short internal ID as the filename.

| Item | Deadline |
| --- | --- |
| Diagnostic report, its attachment and related correspondence | Receipt date plus 90 calendar days |
| Contributed shot data, the email holding it and any retained working copies or derived rows still linked to it | Receipt date plus 12 calendar months. Use the last day of the target month if the receipt day is absent. |
| Access, correction or deletion request | Record receipt and the applicable legal response deadline, if any. Track it separately from the item's normal expiry. |

1. At intake, assign a case ID and log only the category, original receipt date, due date, mailbox item reference, relevant file or dataset location, assigned handler and status. For contributions, keep the export ID if needed to locate submitted data. Do not copy the message body, attachments or private notes into the register. A duplicate or later reply does not restart the earlier item's retention period. Separate mixed submissions so retaining a contribution does not also retain the expiring diagnostic. Remove redundant downloaded files once the controlled copy is in place.
2. At intake, also schedule a private reminder at least seven days before expiry. Review the register weekly, including deadlines due before the next planned review, and act early for weekends or absences. The mailbox categories and reminders are tracking aids. They do not delete anything automatically.
3. At expiry, delete the tracked item and its copies under Tull Labs' control from Inbox, Sent, archive folders and working storage. Remove linked contribution rows from research datasets. Empty the relevant Deleted Items, recoverable items and working-storage recycle bin where provider controls permit. Verify completion and record the date, handler and result with minimal detail. If a provider backup or a legally required hold prevents complete removal, restrict access, document the reason and next review date, and record or explain any remaining limits accurately. Agree provider recovery behavior and deletion of register entries before accepting submissions.
4. For a request at TullLabs@outlook.com, acknowledge it and make a register entry. Locate submissions by sender, approximate receipt date, case ID or contribution export ID. Check only enough information to avoid acting on another person's records. Search for copies and linked rows. Remove items under Tull Labs' control where applicable, record the result and tell the requester what was removed or why anything was retained. Direct them to their own provider or other recipients for copies outside Tull Labs' control.

Ordinary support mail without a report or contribution, the register itself, and provider retention after removal still need a separate retention decision. Keep those records to the minimum needed and do not imply that the approved category periods cover them.

## Compliance checks still open

- Confirm access controls, provider recovery and backup behavior, and retention for ordinary correspondence and request records before claiming the manual procedure is operating.
- Confirm the Play account creation date, applicable testing requirements and verified legal identity and contact details. For a personal trader, review the address and phone information Play may display where applicable, including EEA and UK rules. Keep private verification details out of Git. [Required developer information](https://support.google.com/googleplay/android-developer/answer/13628312) · [Trader status](https://support.google.com/googleplay/android-developer/answer/17594752)
- Confirm applicable jurisdictions and processors. If New Zealand's Privacy Act applies, confirm responsibilities for access, correction, storage and retention, and assess overseas processor arrangements and any indirect collection. Check response deadlines, breach handling, and relevant destination-market obligations before launch. [New Zealand privacy principles](https://www.privacy.org.nz/privacy-principles/)
- After physical camera, BLE and WebView testing, reconcile the final AAB, delivery channels and [Data Safety worksheet](PLAY-DATA-SAFETY.md). Confirm developer-controlled mail transport before answering Play's encryption-in-transit question.
