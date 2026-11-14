# Maximus mobile — store release guide (Phase 10)

Companion app to a Maximus server (self-hosted or Maximus-hosted). Bundle
`com.maximusbot.app` on both stores. Versioning: `mobile/pubspec.yaml` tracks
the root `package.json` (`dart tool/sync_version.dart`, `--check` in CI);
the release lane stamps `+<run number>` as the build.

## Release lane

Tag `maximus-mobile-v*` (or manual dispatch) runs
`.github/workflows/maximus-mobile-release.yml`:

1. Gate: version check → `flutter analyze` → `flutter test test/`.
2. iOS: signed `.ipa` → TestFlight internal testers.
3. Android: signed `.aab` → Play internal track.

Promoting to production stays a manual store action. All signing material
and store configs live in repo secrets (see the workflow header) — never
in the repo. Local release builds fall back to debug keys when
`android/key.properties` is absent.

## Owner checklist before the first tag

- [ ] Apple Developer (paid): app record, `com.maximusbot.app.LiveActivities`
      extension id, App Group `group.com.maximusbot.app`, Siri + Live
      Activities capabilities, distribution cert + both provisioning
      profiles in secrets.
- [ ] Play Console: app record, upload key + service account in secrets.
- [ ] Firebase project + APNs `.p8` + service-account env
      (`mobile/PUSH_SETUP.md`); both `GoogleService` files in secrets.
- [ ] IAP products exist in both stores: `maximus_plus_monthly`,
      `maximus_pro_monthly`; Apple App Store Server API key + Google
      service account + RTDN wired to the worker.
- [ ] Server URL the app points at by default (Settings → service
      endpoint stays user-overridable: production / local / custom).
- [ ] Listings below pasted; screenshots + privacy answers submitted.

## Listing copy

Name: **Maximus — AI teammate**
Subtitle (iOS) / short description (Play): Your bots, briefs, and
approvals — from your pocket.

Description:

> Maximus is your proactive AI teammate. It reads your email and calendar,
> briefs you every morning, drafts replies, runs routines on a schedule,
> and asks for approval before it acts — from your pocket.
>
> - Morning briefs and ask-me-anything threads with your bots
> - Approvals in one tap: allow once, deny, or always allow
> - Talk or dictate: live voice calls and mic dictation
> - Routines, computer screen review, and on-phone calendar, contacts,
>   location, and reminders tools
> - Siri shortcuts, lock-screen activities, push that respects Desktop
>
> Maximus connects to your own Maximus server. Bring your own model keys
> or subscribe to a bundled plan; purchases sync across web, desktop,
> and mobile.

Keywords (iOS): ai assistant, bots, brief, approvals, voice, routines,
productivity. Category: Productivity. Age: 4+ / Everyone.

Support URL: the marketing site. Privacy policy URL: the marketing
site's privacy page. (Owner supplies both before submission.)

## Screenshots (6.7" iPhone + 10" Android)

Capture on staging with the demo bots (welcome → pair → brief):

1. Morning brief home (Briefing + needs-you row).
2. Thread with approval card (Allow once / Deny / Always allow).
3. Live voice call (on-line indicator + elapsed clock).
4. Dictation composer (listening state).
5. Routines list + computer screen review.
6. Siri Shortcuts list / lock-screen activity (device shot).

Feature graphic (Play): Ember-on-Paper key art, no text below 24sp.

## Apple privacy answers (App Privacy)

- Data collected, linked to the user: email address (account sign-in),
  purchase history (subscription status). Not used for tracking.
- Data collected, not linked: crash logs, performance diagnostics
  (Firebase), push tokens (notifications).
- No tracking; no third-party advertising SDKs. Microphone, speech
  recognition, camera, calendar, contacts, location, and reminders are
  used only after an explicit in-app tap, and transcripts of live calls
  are never stored.
- Privacy manifest: `ios/Runner/PrivacyInfo.xcprivacy` +
  `ios/LiveActivities/PrivacyInfo.xcprivacy` (UserDefaults CA92.1 for
  the shared Siri bot list).

## Play Data safety answers

- Collected: email (account), purchases (subscriptions), crash logs +
  diagnostics (Firebase Crashlytics/Performance), push tokens (FCM).
- Shared: subscription status with the Maximus control plane (the
  account backend); no sale, no ad SDKs.
- Permissions: microphone, camera, calendar, contacts, location,
  reminders/alarms — all optional, requested in context, core chat
  works without them. Data encrypted in transit (TLS) and deletable
  via Settings → delete account.
