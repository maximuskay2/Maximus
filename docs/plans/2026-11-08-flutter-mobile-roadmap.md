# Maximus Flutter mobile roadmap (2026-11-08, rev 3 — Grok Bot benchmark + UI/UX)

## Goal

Ship a Maximus-owned Flutter app for iOS + Android that works like Grok Bot
for mobile (https://docs.x.ai/grok-bot/overview,
https://docs.x.ai/grok-bot/mobile): the phone connects to the same bots,
conversations, routines, connectors, and shared computer as desktop, and work
continues in the cloud when the app is closed. Scope: start work, message bots
(text/dictation/live voice), approve steps, review results, manage routines,
review the shared computer, run on-phone tools, subscribe via in-app purchase —
one codebase, both stores.

## Success Criteria

- One `mobile/` Flutter codebase (iOS 18+, Android 9+) builds signed iOS +
  Android binaries from CI.
- A user can sign in, pair by QR or code, chat with streaming replies, dictate
  or voice-chat, approve/deny cards, receive closed-app push, manage routines,
  review the shared computer, and subscribe monthly in-app.
- Desktop and phone share one account, one plan, one usage pool; phone stays
  quiet for bots whose alerts go to an active desktop.
- TestFlight + Play internal-track builds verified against staging before any
  store submission.
- The app feels unmistakably Maximus (not a generic chat template): one
  design language across light/dark, every screen has designed empty, error,
  offline, and loading states, and first-run to first reply takes minutes.

## Approach

Companion-grade client, not a desktop port: the phone holds no bots, engines,
or credentials beyond its own session. The phone pairs like any companion
device (`x-maximus-companion-auth`, `server/request-auth.ts`); message routes
already cover phone clients (`POST /api/bots/:id/messages`, incl. a "from a
registered phone" test). No new server *auth* surface is needed — but unlike
rev 1, the Grok Bot benchmark does need new server *capability* surfaces:
Android push, a voice realtime endpoint, an on-phone tool protocol, and
store-receipt verification.

### Key Decisions

- Flutter (user constraint), `mobile/` beside `electron/`, minimums iOS 18 +
  Android 9 (Grok Bot's floor). Dart-only networking over `dart:io` HttpClient
  + hand-rolled SSE parser against `/api/events` (`src/lib/live-events.ts`).
- Sessions/tokens in `flutter_secure_storage` (Keychain/Keystore)
  (https://pub.dev/packages/flutter_secure_storage); one credential per
  server; existing users land on the synced bot list, new users get a
  first-run tour + first bot.
- QR pairing via `mobile_scanner`
  (https://pub.dev/packages/mobile_scanner) + manual code fallback;
  pairing endpoints `POST /api/auth/pairing` + `POST /api/auth/pair`.
- Markdown via `flutter_markdown_plus`
  (https://pub.dev/packages/flutter_markdown_plus); `flutter_markdown` is
  discontinued (https://pub.dev/packages/flutter_markdown) and must not be
  used.
- Attachments via `file_picker` (https://pub.dev/packages/file_picker);
  generated images render from reply attachments (server-side
  `generate_image`, `docs/image-generation.md`); share-sheet input via
  `receive_sharing_intent`
  (https://pub.dev/packages/receive_sharing_intent) into the composer.
- Voice: dictation via `speech_to_text`
  (https://pub.dev/packages/speech_to_text, short-phrase scope); voice-memo
  playback + live voice chat via `record`
  (https://pub.dev/packages/record) and `just_audio`
  (https://pub.dev/packages/just_audio) against a new server realtime voice
  endpoint (full-duplex audio + transcripts into the conversation).
- Push via `firebase_messaging`
  (https://pub.dev/packages/firebase_messaging); server gains an FCM HTTP v1
  sender (https://firebase.google.com/docs/cloud-messaging/send-message) next
  to the existing APNs sender (`cloudflare/control-plane/src/push.ts`,
  APNs-only today). Routing rule: alerts go to an active desktop instead of
  the phone; per-bot toggle + global kill switch.
- In-app purchase via `in_app_purchase`
  (https://pub.dev/packages/in_app_purchase): monthly individual plans only;
  yearly/Teams/Enterprise stay on the web; existing web/plan access must never
  trigger a second subscription; the stores own cancel/refund; the control
  plane verifies receipts into entitlements.
- Maximus brand throughout (two-tone M, paper `#F5F1E8`, ember `#C2410C`,
  ink `#14110B`); service endpoint presets mirror the desktop picker.
- Design system: Flutter's bundled Material widget catalog, fully re-themed
  to Maximus tokens (https://docs.flutter.dev/ui/widgets/material), with
  Cupertino widgets for iOS-native patterns (share sheet, action sheets,
  switches) — no third-party UI kit. One token set drives light, dark, and
  dynamic-type layouts.

## UI/UX Approach ("Ember & Paper")

Design language, fixed in Phase 0 and binding on every later phase:

- **Brand tokens**: ink `#14110B` (dark surfaces), paper `#F5F1E8` (light
  surfaces), ember `#C2410C` (primary action + "needs you" accents only),
  two-tone M mark for launcher, splash, avatars, and empty states. Dark-first
  chat like the benchmark; Appearance setting offers System/Light/Dark.
- **Typography with hierarchy**: platform text styles with real display /
  headline / body separation, Dynamic Type supported; never one weight and
  size throughout, never gray-on-gray body copy.
- **Shape with intent**: chat bubbles, approval cards, and content cards each
  get their own radius and elevation — never one radius on every element,
  never cards nested in cards, never left-border accent strips.
- **No AI-slop visuals**: no purple/blue gradients, no glow on every card, no
  bento-grid-everywhere, no emoji as icons, no glassmorphism coating, no
  scroll-in animation spam; all motion honors reduced-motion settings.

App structure (Grok Bot-shaped, Maximus-skinned), max five destinations:

- **Home**: greeting + briefing card ("what's new across your bots") + recent
  threads + big `+` for New Bot / New Group Chat.
- **Chat**: streaming replies with typing presence, suggestion starters,
  composer with `+` (photo, file, voice, dictation), per-conversation drafts,
  mentions, thread replies, reactions; bot presence chips
  (idle / working / waiting on you).
- **Bot profile** (tap the bot name): Library (pages, images, videos, files,
  links), routines, per-bot Notifications toggle, members, delete.
- **Approvals**: inline cards in chat + push deep-links; Allow once / Deny /
  Always allow with clear destructive styling; permission cards always name
  the device that must answer.
- **Settings**: account, plan/usage, devices, appearance, language, haptics
  toggle, timezone, feedback, sign out.

Experience principles:

- **One-thumb**: primary actions in reach; swipe actions for routine
  pause/delete and conversation pin/hide.
- **Progressive disclosure**: calm simple default, advanced controls behind
  "show more" (mirrors the desktop Simple/Advanced modes).
- **Trustworthy agency**: every autonomous bot action is inspectable
  (activity feed per bot), reversible where possible (edit/discard drafts),
  and gated by explicit permission cards — the user always knows what ran
  and why.
- **Sweet details, sparingly**: ember pulse only on "waiting on you" states;
  shared-element transitions between chat and Library; haptic confirmation
  on send/approve (toggleable); morning-briefing card as the signature home
  moment.
- **Every screen, four states**: content, empty (with the next action),
  error/offline (with retry), loading (skeleton, not spinner walls). A
  screen without all four is not done.

Process gate: each phase ends with a design review — screenshots from a real
iPhone + a real Android against the tokens, golden tests for new core
widgets, and a first-run/empty/error/offline walkthrough before the phase
counts as complete.

## Steps

### Phase 0 — Scaffold + API client

- `flutter create` under `mobile/` (bundle id/applicationId default
  `com.maximus.app`, owner-confirmed); brand theme; app icon from
  `build/icon.svg`; min SDKs set.
- Design tokens (colors, type scale, radii, elevation, motion) + a component
  gallery screen proving every token in light/dark/dynamic-type; golden
  baselines for the gallery.
- API client: endpoint presets, session + companion-token auth, typed models,
  SSE parser with reconnect hydration, 401/403/429 mapping.
- `flutter analyze` gate + unit tests for client/parser/storage.

### Phase 1 — Auth + pairing + first-run + switcher

- Email OTP sign-in; control-plane URL presets; first-run tour + first bot
  for new users, synced bot list for existing.
- QR → pairing-link parse (`shared/pairing-link.ts`) → pair; manual code;
  chat-only vs full scopes honored; multi-server switcher; logout + revoke.

### Phase 2 — Read: bots, threads, library, search

- Bot/room lists, threads, paged transcripts, unread state, pin/hide
  conversations, per-bot Library (pages, images, videos, files, links),
  home search across messages/bots/groups/files/routines (`/api/search`).

### Phase 3 — Chat core

- Composer: text, per-conversation saved drafts, mentions, thread replies,
  reactions, attachment upload, photo/file pick, share-sheet input,
  voice-memo playback, editable drafts (Send/Discard), streaming replies,
  stop/interrupt, retry; bot/group create, edit profile, members, delete.
- Disk cache + TTL + LRU eviction + prefetch policy (Phase 2 scope —
  caching behavior upgrade).
- Build note (found Phase 0): `receive_sharing_intent` 1.9.0 needs Android
  SDK 37 (above Flutter's pinned 36) and 1.7.0–1.8.1 fail AGP 9's JVM-target
  check — re-add at this phase with the then-current toolchain and solve the
  alignment then (upgrade, or a fork with aligned targets).
- Status (built 2026-11-09): DONE — composer/drafts/mentions/replies/
  reactions/upload/streaming/stop, bot create+patch, group create + room
  setup, disk cache (TTL + LRU + stale-while-revalidate + prefetch).
  Deferred: share-sheet input (toolchain conflict stands),
  voice-memo playback UI beyond attachment rows (Phase 5 voice), server
  has no bot-delete endpoint (archive covers removal). Live-proven:
  send/react/unreact/interrupt/image-upload/bot-CRUD/group-CRUD +
  on-device send/react/group-create + cache unit suite.

### Phase 4 — Approvals + push + routing (client + server)

- Approval/question cards (Allow once / Deny / Always allow), permission
  cards naming the device that must answer.
- Client: FCM token, register via
  `POST /v1/installations/self/push/register`, per-bot + global toggles,
  deep-link tap → thread.
- Server: FCM sender, token-type routing, desktop-preferred routing,
  APNs-path-mirroring rate limits, migration if needed, unit tests.
- Status (built 2026-11-09): DONE — approval/question cards in-thread
  (Allow once / Deny / Always allow, option chips, free-text + structured
  answers, dismiss, settled receipts, computer-ask device line) over
  POST /api/threads/:id/respond; FCM sender (service-account JWT +
  HTTP v1) with access-token cache; fanout off notify() with needs-you
  urgency, per-bot + global toggles, desktop-preferred (phone marks SSE
  ?client=mobile), forPerson scoping, per-thread coalescing + hourly
  caps, dead-token pruning; routes POST|DELETE
  /v1/installations/self/push/register, GET .../push, PATCH
  .../push/settings, POST .../push/test (dry-run included); client
  PushController (explicit Enable tap, no auto-prompt), in-app banners,
  tap → thread deep links, You-tab phone/global/per-bot rows.
  Live-proven: push register/status/settings/unregister + respond wiring.
  Owner-gated: Firebase project + APNs .p8 + service-account env
  (mobile/PUSH_SETUP.md) before the closed-app buzz proof.

### Phase 5 — Dictation + live voice chat (client + server)

- Dictation into the composer; live voice chat with on-line indicator,
  transcripts appended to the conversation.
- Server: realtime voice endpoint (audio in/out, turn-taking with the bot
  engine, usage metering through the existing ledger).
- Status (built 2026-11-09): DONE — dictation into the composer via
  on-device speech recognition (mic button, live transcript, no server
  key); live voice calls over WebRTC (mic → offer → POST
  /api/live/session {client ios/android} → answer, mute/speaker/hangup,
  full-screen call UI with pulsing on-line indicator + elapsed clock,
  server-state polling, needsKey/busy/mic failure mapping); server
  already had the realtime stack (TTS/speak/transcribe + live WebRTC +
  call rows), Phase 5 added ledger metering (meterCall → one
  driverKind=live-call row with seconds, no cost, engine-groupable).
  Transcripts decision: the server deliberately never stores call speech
  ("never anything said on it", twice invariant) — calls append the call
  row (who/when/how long) plus any bot messages said during the call,
  and the phone shows no captions; breaking that needs an explicit owner
  call. Live-proven: transcribe→409 without Fish key, session→409
  needsKey, current/end wiring. Owner-gated: Fish Audio key for server
  transcription, OpenAI/Azure key for live calls.

### Phase 6 — Routines + computer review + on-phone tools

- Routines: inspect schedule/next run/history, pause/resume, delete,
  edit-via-chat-draft, add new (testing stays desktop-only).
- Computer review: watch the shared computer screen, take over for
  password/2FA/CAPTCHA, hand back (reuse desktop-viewer endpoints; update /
  recovery stay desktop-only).
- On-phone tools (foreground-only, new client-executed-tool protocol):
  calendar, contacts, location, alarms/timers (+ reminders/home on iOS),
  permission cards, per-device policy (ask/always/never), device list with
  rename/online state/remove-computer.
- Status (built 2026-11-09): DONE — routines inspect/pause/resume/delete/
  edit-via-draft/add over /api/routines*; computer screen watch + takeover
  over the desktop-viewer endpoints (v1 browser SSE); on-phone tools via the
  client-executed-tool protocol (calendar, contacts, location, alarms/
  timers, reminders/home on iOS), foreground-only long-poll + lease,
  permission cards, per-tool ask/always/never. Unit + live green.

### Phase 7 — Owner manage + settings

- Seats/invites, spend + allowance, provider toggles over `/api/console/*`.
- Settings: account, bot settings, auto review, timezone, bot computer
  (snapshot reset, disk), devices, appearance, language, haptics, usage,
  feedback, sign out, delete account.
- Status (built 2026-11-09): DONE — seats/invites, spend + allowance,
  provider toggles over /api/console/* (console account token in secure
  storage, Bearer + companion header auth); full settings surface
  (account, bot settings, auto review, timezone, bot computer, devices,
  appearance, language, haptics, usage, feedback, sign out, delete
  account); presence zone/language best-effort. Unit + live green.

### Phase 8 — Subscriptions (client + server)

- Paywall with monthly individual plans, upgrade flow, subscription status
  screen; web-plan holders never see the paywall.
- Server: store-receipt verification → control-plane entitlements, renewal /
  cancel / refund webhooks, no-double-subscribe rule in the grant logic.
- Status (built 2026-11-10): DONE — paywall (all-free memberships without
  an active store sub only), monthly upgrade flow, status screen;
  web-plan holders never see it. Server: store-billing module
  (Apple/Google server-side verification, every grant follows an API
  read; webhooks are untrusted triggers), /api/billing/store/verify|
  /status, /api/billing/webhook/apple|/google proxied via
  /api/console/billing/store/*; no-double-subscribe (409), idempotent
  grants, completePurchase only after the server answers. Worker vitest
  7 pass, console proxy 12 pass; client unit + fail-closed live green.
  Owner-gated: IAP ids, Apple Issuer/Key, Google service account + RTDN.

### Phase 9 — iOS system integrations (native Swift)

- Voice-assistant shortcuts (list bots, send message, dictate, voice chat),
  lock-screen activities for dictation + voice chat, hardware-button shortcut
  (all benchmarked by the Grok Bot mobile doc above).
- Status (built 2026-11-10): DONE — 4 App Intents + App Shortcuts
  (Action-button assignable); `maximus://` scheme with bots/thread/dictate/
  call hosts; DeepLinkRouter (bot-name match, prefill, auto-dictate,
  signed-out pending + flush); dictation + call Live Activities via the
  `maximus/live_activities` channel; widget extension target
  (com.maximus.app.LiveActivities) with lock-screen + Dynamic Island UI;
  Siri bot list via App Group (free-text fallback unsigned). 17 unit/
  widget tests green; sim build + install + launch proven, scheme
  registration proven by the system open prompt, integration suite green.
  Owner-gated: paid Apple Developer (App Group, activities on device)
  + real-device Siri/activity proof.

### Phase 10 — Store release

- Signing (secrets in CI only), versioning from `package.json`, TestFlight +
  Play internal track, listings + screenshots, privacy answers, release lane
  in CI reusing the desktop signing pattern.
- Status (built 2026-11-10): DONE — `mobile/tool/sync_version.dart`
  (pubspec tracks package.json, `--check` gate; now 0.1.144+1);
  `maximus-mobile-release.yml` (tag `maximus-mobile-v*`: version/analyze/
  test gate → signed ipa to TestFlight + signed aab to Play internal,
  secrets-only); ExportOptions.plist; Android upload-key wiring with
  local debug fallback (release aab builds, 88.6MB); PrivacyInfo in both
  iOS bundles; `mobile/STORE_RELEASE.md` (listing copy, 14 sim shots +
  deep-link proof shots, Apple + Play privacy answers); device ipa-shape
  build green unsigned (40.5MB + appex). Owner-gated: certs, profiles,
  API keys, service accounts, IAP products, Firebase files (all listed
  in the workflow header + guide).

### Non-goals

On-device bot hosting, engine CLIs, CUA drivers, browser engine, DuckDB,
cloudflared, computer update/recovery on mobile, routine testing on mobile,
closed-app VoIP calling.

## Validation Plan

- Every phase: `flutter analyze` + `flutter test` clean; widget tests for new
  screens; client tests against recorded fixtures; design-review gate passes
  (token check on real-device screenshots, goldens green, four-states
  walkthrough done).
- Phases 1–3: live E2E on the local stack (worker `:8787` + harness):
  sign-in → pair → read → send → stream → interrupt → drafts → share-in.
- Phase 4: closed-app push on a real Android + TestFlight iPhone, desktop
  routing verified (alert to desktop while active, phone when idle),
  tap deep-links; server FCM tests green.
- Phase 5: live voice chat E2E with transcripts in-thread on real devices.
- Phase 6: routine pause/resume/delete live; computer takeover on staging;
  on-phone tool permission-card flow on both platforms.
- Phase 8: sandbox purchases end-to-end (buy → entitlement → cancel →
  revoke) on both stores before submission.
- Highest-risk checks: Phase 5 live voice (new realtime endpoint) and Phase
  4 closed-app push (needs Firebase + APNs key + store-track builds).

## Risks / Open Questions

- Owner-gated: Apple Developer + Play Console enrollments, Firebase project,
  APNs Auth Key (.p8), bundle id/applicationId, plan catalog for IAP product
  IDs (monthly individual set).
- Phase 5/6/8 add new server surfaces (voice realtime, tool protocol, receipt
  verification) — the largest scope beyond rev 1; each needs its own contract
  + tests before the client lands.
- Emulator-only CI cannot prove push, camera, mic, or store billing; those
  phases need real devices or store-track builds.

## Sources

- https://docs.x.ai/grok-bot/overview
- https://docs.x.ai/grok-bot/mobile
- https://pub.dev/packages/firebase_messaging
- https://pub.dev/packages/flutter_secure_storage
- https://pub.dev/packages/mobile_scanner
- https://pub.dev/packages/file_picker
- https://pub.dev/packages/speech_to_text
- https://pub.dev/packages/record
- https://pub.dev/packages/just_audio
- https://pub.dev/packages/receive_sharing_intent
- https://pub.dev/packages/in_app_purchase
- https://pub.dev/packages/flutter_markdown_plus
- https://pub.dev/packages/flutter_markdown
- https://firebase.google.com/docs/cloud-messaging/send-message
- https://docs.flutter.dev/ui/widgets/material
