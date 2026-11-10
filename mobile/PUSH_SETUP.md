# Push setup (owner steps)

The app's push path is built end to end, but delivery needs a Firebase
project and a server service account. Until then the app reports push
"unavailable" and everything else works.

## 1. Firebase project (once)

1. Create a project at <https://console.firebase.google.com> (e.g.
   `maximus-push`).
2. Add an iOS app, bundle id `com.maximus.app`; download
   `GoogleService-Info.plist` into `mobile/ios/Runner/` and add it to the
   Runner target in Xcode (File → Add Files).
3. Add an Android app, application id `com.maximus.app`; download
   `google-services.json` into `mobile/android/app/` and apply the plugin:
   - `mobile/android/settings.gradle.kts`: add
     `id("com.google.gms.google-services") version "<latest>" apply false`
     to the `plugins` block.
   - `mobile/android/app/build.gradle.kts`: add
     `id("com.google.gms.google-services")` to the `plugins` block.
4. iOS delivery goes through APNs: in the Firebase console → Project
   settings → Cloud Messaging → Apple app configuration, upload the APNs
   Auth Key (`.p8`, with Key ID + Team ID) from the Apple Developer
   portal. Without it, iPhones register but never buzz.
5. Rebuild: `cd mobile && flutter run`.

## 2. Server credentials (every install that sends push)

1. Firebase console → Project settings → Service accounts → Generate new
   private key (JSON).
2. Set on the server (env or secret store — never in the repo):
   - `MAXIMUS_FCM_PROJECT_ID` — Project ID
   - `MAXIMUS_FCM_CLIENT_EMAIL` — client_email from the JSON
   - `MAXIMUS_FCM_PRIVATE_KEY` — private_key from the JSON (`\n`
     escapes are accepted)
3. Restart the server. `GET /v1/installations/self/push` now reports
   `configured: true`.

## 3. Closed-app proof

1. On the phone: You tab → Turn on push (accept the OS prompt).
2. Force-quit the app (swipe it away — terminated, not backgrounded).
3. As an admin: `POST /v1/installations/self/push/test` with `{}`.
   The phone buzzes with "Push is working" even though the app is dead.
4. Tap the banner: the app launches straight into the conversation
   (the test banner has no thread, so it lands on Home; a real
   approval/mention banner opens its thread).

## How it behaves

- Permission is never requested on its own: the You tab offers Turn on
  push, and only that tap shows the OS prompt.
- Approvals, questions, sign-ins, secrets, incidents, failures, mentions,
  spend and briefs always push. Finished work (done, delegation-settled,
  waits, notices) stays quiet while a desktop/web stream is open or the
  bot is muted, and coalesces to one banner per thread per minute
  (max 20 FYI + 60 total per phone per hour).
- Kill the app and tap a banner: `getInitialMessage` routes to the
  thread. While the app runs, banners arrive in-app with a View action.
