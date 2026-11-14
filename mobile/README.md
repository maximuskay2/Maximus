# Maximus mobile

Flutter companion for a Maximus server (self-hosted or
[app.meetnote.cc](https://app.meetnote.cc)). Bundle id `com.maximusbot.app`.

## What it does

- Pair or sign in to a harness (email OTP, password, OAuth where configured)
- Chat with bots and rooms; cards for approvals, connectors, secrets, widgets
- Subscribe / BYO / Muse plan flows
- Phone apps: reminders, alarms, HomeKit (iOS), share extension → `maximus://share`
- Push (Firebase) — see [PUSH_SETUP.md](PUSH_SETUP.md)

Admin-only server pages (Usage, Your AI / engines) are hidden for `client`
sessions; sign in as the home owner for those.

## Develop

```sh
cd mobile
flutter pub get
flutter run
```

Point the app at a server: welcome / sign-in URL, or Settings → service
endpoint (production / local / custom). Default product origin:
`shared/product-origin.ts` (meetnote).

```sh
flutter analyze
flutter test test/
```

Version tracks the root `package.json` via `dart tool/sync_version.dart`.

## Layout

| Path | Role |
| --- | --- |
| `lib/api/` | HTTP client + models |
| `lib/auth/` | Session store, sign-in, splash |
| `lib/chat/` | Thread, composer, cards |
| `lib/home/` | Inbox / sheet |
| `lib/engines/` | Your AI (BYO keys) |
| `lib/billing/` | Paywall / subscribe |
| `lib/phoneapps/` | Native phone-app jobs |
| `ios/` · `android/` | Platform projects + share extension |

## Release

Store checklist and listing copy: [STORE_RELEASE.md](STORE_RELEASE.md).  
CI: tag `maximus-mobile-v*` → `.github/workflows/maximus-mobile-release.yml`.

## Docs index

Repo-wide manual: [docs/README.md](../docs/README.md).
