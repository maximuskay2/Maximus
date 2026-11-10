## Goal

Ship **Maximus v0.1.0** as one single, unified, fully monetized tri-platform commercial release — full rebrand, own enterprise gate, hosted control plane with OIDC SSO, metered billing with webhooks, signed macOS/Windows/Linux installers, production infrastructure. Day one also ships **five LLM providers (Claude, ChatGPT/Codex, Grok, Kimi, Muse)** behind a three-level on/off switchboard, and **dual subscriptions**: bring-your-own (BYO) plus LLM-included (allowance + overage). No phased MVP, no features held for v2. Sequential phases are replaced with parallel engineering streams converging on one release gate.

## Success Criteria

- One release tag (`maximus-v0.1.0`) carries everything: rebrand, gate, hosted backend, billing, signed tri-platform installers, production infra.
- No `enterprise/` code from upstream remains; no OpenMausBot/MausBot brand, bundle IDs, protocol, or updater feed references ship in the product.
- macOS (Apple silicon + Intel, signed + notarized), Windows x64 (OV-signed, no SmartScreen warning), and Ubuntu 24.04 x64 (`.deb` + AppImage) installers all install, launch, embed the harness, complete an agent turn, and self-update on day one.
- All five providers work day one and can each be switched on/off at three levels: global operator kill-switch, per-workspace admin toggle, per-bot model choice. Off providers hide from the picker with a reason.
- Both subscription modes work day one: BYO (user's own CLI logins / API keys, unbilled by us, behavior unchanged from upstream) and LLM-included (monthly model-spend allowance per workspace, overage per token at our sell prices, routed through our managed gateway with our keys).
- Every enterprise feature (brand overrides, spend caps, billing prices, admin surfaces, SSO) is live behind our gate and paid entitlements on day one.
- Hosted path works end to end: sign-up → workspace → pay → entitlements light up; failed/cancelled payments trigger grace + banners without data loss.
- Attribution obligations kept (`LICENSE`, `NOTICE`, `third_party/`), and our new enterprise code lives under our own license.

## Approach

Five parallel tracks run concurrently and merge at a single release gate. To avoid cross-contamination and integration debt, contracts freeze first: the gate interface (`entitled()`, `editionStatus()`, `createWorkspaceAccess()`, `hostedWorkspaceConfiguration()` in `server/enterprise.ts`), the entitlement ID set, the provider switchboard schema (provider id, three toggle levels, assignment policy), the webhook event schema, and the control-plane contract version (same role as `HOSTED_CONTRACT_VERSION` in `server/hosted-contract.ts`). Tracks build against those contracts; the release gate proves them together.

```
[ Track 1: Rebrand & Tri-Platform Packaging ] ──┐
[ Track 2: Clean-Room Enterprise Gate       ] ──┼──> [ Release Gate ] ──> Maximus v0.1.0
[ Track 3: Hosted Control Plane & SSO       ] ──┤   (5 providers · BYO + bundled)
[ Track 4: Metered Billing & Webhooks       ] ──┤
[ Track 5: Production Infrastructure & CI/CD] ──┘
```

Reuse the Apache-2.0 core (`src/`, `server/`, `electron/`, `shared/`, `deploy/`, `cloudflare/` patterns); delete `enterprise/` on day one and never build on it. Claude, ChatGPT/Codex, and Grok ride their existing drivers. Kimi and Muse are new integrations: Kimi via the Kimi API's OpenAI-compatible (Chat Completions, Responses) and Anthropic-compatible (Messages) protocols; Muse via the Muse Code CLI as a spawned agent and/or the Meta Model API's compatible protocols (Responses, Chat Completions, Messages) — both verified against official provider docs (see Sources). The gated features in core (`server/brand.ts`, `server/spend.ts`, billing prices, Installations/settings surfaces) stay — Track 2 repoints their checks at our gate while Tracks 1, 3, 4, 5 proceed in parallel.

The dual-subscription split reuses the shape already proven in `server/hosted-models.ts`: BYO traffic uses the user's credentials directly (never metered, never billed); bundled traffic routes through our managed gateway (`/api/gateway/{workspace}`-style) with our provider keys, a per-workspace token, a per-provider assigned-model catalog, and enforcement at selection time. Metering runs on `server/usage-ledger.ts`, caps on `server/spend.ts`, prices on the billing-price surfaces. Mixed mode is allowed per provider (e.g. BYO Claude + bundled Kimi in one workspace).

Assumptions (reversible): core stays Apache-2.0; new `maximus-enterprise/` is proprietary; **full** cutover from `OMB_*` to `MAXIMUS_*` (no compat shim — one-time data import from `~/.openmausbot` to `~/.maximus` only); hybrid billing (base subscription per workspace + metered overage); payment providers Stripe/Paystack per owner direction; OIDC SSO ships day one; Docker self-host + Maximus-hosted SaaS both supported; day-one provider roster is exactly Claude, ChatGPT/Codex, Grok, Kimi, Muse — further providers arrive via the same switchboard + driver pattern post-launch.

## Steps

### Track 1 — Rebrand & tri-platform packaging (with day-one signing)

- Global purge: replace `OpenMausBot`, `MausBot`, `openmausbot`, `com.openmausbot.app`, `openmausbot://` with Maximus identity across code, strings, docs (`README.md`, `apps/docs/content`, onboarding, settings, errors), and packaging config. Attribution/history hits (`NOTICE`, `third_party/`, migration shim) are the only exceptions.
- Identity per platform: `package.json` (`name`, `desktopName`), `electron-builder.yml` (`appId`, `productName`, protocol scheme, `publish` owner/repo, per-target `mac`/`win`/`linux` blocks), `index.html`, `rail.html`, `DEFAULT_BRAND` in `server/brand.ts`, window/menu/tray strings in `electron/`, `build/` assets (mac `.icns` + entitlements, Windows `.ico` + metadata, Linux icons + `.desktop` file), installer/artifact names per target, PWA/manifest assets.
- Env + data cutover: `MAXIMUS_*` everywhere; first-boot migration handler moving the local store from `~/.openmausbot` to `~/.maximus` (copy-then-verify, never move-then-hope; source left intact until the new store boots clean).
- Code signing day one (non-negotiable, start procurement immediately): Apple Developer ID signing + automated notarization in CI (both arch DMGs + ZIP; Swift/Xcode build host per `package:mac`); Windows Organization Validation cert so the NSIS `.exe` bypasses SmartScreen; Linux `.deb` + AppImage + checksums. Our releases feed replaces the upstream publish target; `latest-mac.yml` + `latest.yml` ship with every release or installs strand.
- Native runtimes per platform: mac CUA + speech helper (`build:cua`, `build:speech`), Windows CUA (`build:cua:win`, defender-check lane green), Linux verified CUA (`build:cua:linux`: tag-pinned archive, size + SHA-256 + member allowlist + inner hashes, root-owned 0755 ancestors via `afterPack`). Installed app never downloads native automation code.
- Capability matrix enforced + documented (successor of `docs/linux-desktop.md` for all three OSes): host control opt-in macOS + Ubuntu Xorg only, Wayland fail-closed; on-device dictation macOS-only, hosted-key speech-to-text elsewhere; chat/preview/cloud/local-VM everywhere.
- Track-done: `package:mac`, `package:win`, `package:linux` produce signed artifacts that install, boot the embedded harness, and see the update feed; `rg -li 'openmausbot|mausbot'` clean outside attribution.

### Track 2 — Clean-room enterprise gate + provider switchboard (`server/enterprise.ts` + `maximus-enterprise/`)

- Zero-contamination rule: delete upstream `enterprise/` first; write the gate from the interface alone (`RegisteredLayer`, `WorkspaceAccess`, `entitled()`, `editionStatus()`, `createWorkspaceAccess()`, `hostedWorkspaceConfiguration()`). Never open the deleted files for reference during the rewrite.
- New license format: own prefix (e.g. `max1.…`), own Ed25519 keys, own env var (`MAXIMUS_LICENSE_KEY`), our warn/grace/expiry policy, own issue/verify tooling with keys outside the repo (same handling discipline as the old `issue-license.mjs`).
- Provider switchboard (three levels, all day one): (1) operator global kill-switch per provider id; (2) workspace admin enable/disable per provider (extends the `hosted-models.ts` assignment-policy pattern to all five providers + BYO instances); (3) per-bot model choice in the existing picker. Off/unassigned providers hide with a reason; unknown provider ids grant nothing.
- New provider integrations: Kimi driver/instance via Kimi API compatible protocols (pin live model ids at build time against the provider's model list; Moonshot icon preset already exists in `server/provider-icon.ts`); Muse driver via the Muse Code CLI as a spawned agent and/or Meta Model API compatible protocols, following the existing CLI-driver pattern (`customAcp`/native drivers + one registration line per the `server/contracts.ts` SPI). Exact endpoints, tiers, and model ids pinned from official docs at build time and recorded in code comments.
- Full feature gating day one: brand overrides (`server/brand.ts` + `brandSchema`/`loadBrand`, Maximus as default brand), spend caps (`spendState`/`assertWithinBudget` in `server/spend.ts`), billing prices, admin/Installations routes, SSO checks — all behind our entitlement IDs.
- New tests: gate behavior surface (valid/expired/grace/malformed/unknown-feature-ids-grant-nothing), `/api/edition` + `/api/brand` matrix, switchboard matrix (5 providers × 3 levels × on/off), unassigned-model rejection at selection time.
- Track-done: unlicensed server runs a clean free edition; licensed server reports customer + features + expiry; expiry mid-run degrades at grace end without restart; all five providers selectable (or correctly hidden with reasons) per switchboard state; full `pnpm test` subset green.

### Track 3 — Hosted control plane & SSO

- Multi-tenant workspaces: sign-ups, team invitations, roles (admin/member), workspace boundaries, building on `server/sessions.ts` + `server/request-auth.ts` patterns; tenant-host checks and portal-membership semantics we define (same shape as `hostedWorkspaceConfiguration`).
- OIDC SSO day one: full issuer integration + scope mapping behind our gate (upstream has zero SSO checks — greenfield).
- Admin console day one: seats, installations, audit log, spend metrics, entitlement/plan view, provider toggles per workspace, bundled-vs-BYO routing view. Host on `cloudflare/control-plane` (`src/`, `migrations/`, `wrangler.jsonc`) or our replacement stack — migrations forward-only either way.
- Entitlement sync: license server issues/refreshes keys, or hosted servers check entitlements directly; plan catalog maps to provider assignments + allowance sizes; expired/cancelled → grace → free-tier degradation with banner + startup log (same UX shape as `editionStatus`/`licenseWarning`).
- Track-done: isolated hosted-workspace tests (never against live data) covering sign-up/invite/role flows, session revocation + revalidation, contract-version mismatch (409/503, never silent downgrade), tenant-host enforcement, expiry/grace transitions without restart.

### Track 4 — Dual subscriptions: BYO + bundled metered billing

- Routing split: BYO providers use user credentials directly (CLI logins / user API keys), never metered, never billed — today's behavior preserved. Bundled providers route through our managed gateway with our keys, per-workspace token, and assigned-model catalog. Mixed mode per provider allowed.
- Hybrid engine for bundled: base subscription per workspace + monthly model-spend allowance, overage per token at our sell prices — reusing `server/usage-ledger.ts` metering + `server/spend.ts` caps; billable model prices in Usage history + CSV (existing billing-price surfaces, reworded). Allowance-exhausted → overage billing; cap-exceeded → `spend_cap` 409 refusal with admin raise path.
- Checkout + webhooks (Stripe/Paystack): checkout session flow, webhook listeners, cryptographic signature verification, test-mode fixtures. No secrets in client — provider keys and payment secrets stay harness-side (same invariant as TTS/connector keys).
- Idempotent dunning: duplicate-safe event handling, instant grant/revoke, automated grace periods + UI banners on failure/lapse. User data is never destroyed by billing state.
- Track-done: webhook signature/grant/revoke/replay tests green; sandbox purchase → entitlement → unlock → cancel/expire → grace → free-tier enforcement proven on an isolated staging workspace with recorded fixtures; BYO-vs-bundled routing tests prove BYO traffic never touches our keys and bundled traffic never touches user keys.

### Track 5 — Production infrastructure & CI/CD

- Containerization: harden `deploy/local` (Dockerfile, compose, Caddyfile) — strict TLS, `/api/health` checks, scheduled volume backups (SQLite/Postgres), staging vs prod overlays for Maximus domains. Harness-per-workspace stays the isolation unit: one tenant's agents/keys can never see another's.
- Secrets: environment/files only for signing keys, payment secrets, OIDC credentials, and our bundled provider API keys; zero secrets in repo or images; documented rotation; bundled provider keys never leave the gateway side.
- CI/CD release pipeline: type-check (`pnpm typecheck`) → lint (`oxlint --deny-warnings`) → full tests (`pnpm test` incl. broker/electron/packaged-server) → parallel multi-platform compile + sign → publish to our private update feeds. `package-win`, `package-linux`, and defender-check lanes green before any release.
- Observability: structured startup/edition/billing logs, webhook delivery metrics, per-provider usage/cost metrics (our bundled spend vs customer charges — the margin dashboard), updater/packaging checksums; analytics opt-in + documented (same bar as `docs/analytics.md`).
- Track-done: fresh VPS boots from compose; backup/restore drill passes; pipeline produces all three signed installers from one tag.

### Release gate — unified v0.1.0 (all tracks converge, no partial ship)

- Freeze: all five tracks report track-done; contracts unchanged since freeze; `pnpm test` full green on the release candidate.
- Matrix: install → launch → harness boot → agent turn → update check on macOS (both archs), Windows x64, Ubuntu 24.04 x64 (Xorg + Wayland behavior verified) — with at least one turn per provider (BYO + bundled where applicable).
- Money + hosted + rebrand + gate + provider proofs (see Validation Plan) all pass on staging that mirrors production.
- Abort rule: any proof fails → hold the release, fix on the failing track, re-run the full gate. There is no shipping 4 of 5 tracks.
- Cutover: tag `maximus-v0.1.0`, publish OSS core + proprietary enterprise separately, publish tri-platform installers to our feed, announce `~/.openmausbot` migration path.

## Validation Plan

- Continuous: `pnpm typecheck`, `pnpm lint`, focused `vitest` per track; full `pnpm test` before the release gate and on the release candidate.
- Rebrand proof: `rg -li 'openmausbot|mausbot'` across shipped artifacts (excluding `NOTICE`/attribution + migration shim) returns nothing; fresh install on each OS shows Maximus name/icon/protocol everywhere incl. window title, installer, permission prompts.
- Gate proof: `/api/edition` + `/api/brand` matrix across key states; unknown entitlement IDs grant nothing; expiry mid-run stops granting at grace end without restart.
- Provider proof: 5 providers × 3 toggle levels matrix — each combination shows the provider selectable or hidden-with-reason exactly as configured; unassigned-model selection rejected with the managed error; BYO credentials never sent to our gateway and our bundled keys never exposed to workspaces (assert on both directions).
- Money proof (highest-risk validation — do not skip): end-to-end sandbox purchase → webhook → entitlement active → paid feature unlocks → cancel/expire → grace banner → free-tier enforcement, with ledger-backed spend caps and idempotent webhook replays; allowance burn-down and overage charges reconcile against the usage ledger to the cent. This is the step most likely to fail silently (double-grant, missed revoke, test/live key mix-up, metering drift), so run it on an isolated staging workspace with recorded fixtures before the release gate opens.
- Hosted + SSO proof: sign-up/invite/role flows, OIDC login + scope mapping, revocation propagation, contract mismatch 409/503, tenant-host enforcement, backup/restore drill, compose fresh-boot on clean host.
- Tri-platform proof: all three signed installers from one pipeline run; Linux CUA provenance checks + `afterPack` permission assertions pass; Windows defender-check lane passes; SmartScreen shows our signed publisher; macOS Gatekeeper accepts both archs.

## Risks / Open Questions

- Parallel-track integration is the top schedule risk: five tracks merging at once fail unless the frozen contracts (gate interface, entitlement IDs, switchboard schema, webhook schema, control-plane version) hold. Any contract change restarts the affected tracks' track-done.
- New-provider risk: Kimi and Muse drivers are new code against third-party protocols; provider API changes can break bundled supply — pin + record exact endpoints/tiers at build, add provider contract tests, and keep the operator kill-switch as the blast shield.
- Bundled margin risk: our sell prices must exceed provider cost on every model including overage; the margin dashboard (Track 5) must exist before public pricing, and spend caps must be unbypassable.
- License contamination: any line copied from deleted `enterprise/` poisons our ownership claim — enforce clean-room + review the gate diff explicitly.
- Cert procurement is on the critical path: Apple Developer enrollment + Windows OV cert can take days–weeks; start both on day one of Track 1, not at the release gate.
- SSO + billing + hosted auth are security-critical and entirely new; they set the release date, not marketing.
- No-MVP means no fallback: the release gate must be strict (abort rule above) or quality escapes on all platforms at once.
- Payments/tax/compliance (invoicing, refunds, regional rules) need owner sign-off before the gate opens.
- Open questions: (1) Free-tier shape in v1 given everything ships monetized — time-limited trial, feature-limited free, or paid-only? (2) Stripe vs Paystack split — which is primary, and which regions/currencies route to which? (3) Bundled supply tiers — which Kimi tier (standard vs highspeed) and which Muse tier (Spark vs Wonder) back the bundled plans; owner confirms provider accounts?

## Sources

- https://dev.meta.ai/docs/overview
- https://platform.kimi.ai/docs/

## Desktop distribution (2026-11-08, verified)

- Installer icons regenerated from the Maximus mark: `build/icon.svg` (Linux + favicon source),
  `build/icon.iconset` + `build/icon.icns` (mac, via `iconutil`), `build/icon.ico` (Windows, 6 PNG
  entries), `public/app-icon-*.png` + `apple-touch-icon.png` (sharp). Native `.icns`/`.ico`/iconset
  binaries replaced — no upstream mouse art ships anymore.
- Marketing downloads: `/welcome#download` section + header nav + footer link; `GET /api/downloads`
  manifest + `GET/HEAD /api/downloads/file/<name>` streaming from `release/`
  (`server/routes/downloads.ts`, allow-listed names only, zips excluded as update-feed artifacts).
- Desktop auth model (owner decision): installed apps gate loopback like the gated web (`service` +
  strict, `server/request-auth.ts`); the app window's token-bearing requests need a session, the
  Electron main process keeps token powers. Fresh installs offer first-user claim over email OTP
  (`server/account-signin.ts`); headless servers stay fail-closed. Recovery: `MAXIMUS_REQUIRE_AUTH=0`
  + `MAXIMUS_LOOPBACK_TRUST=owner`. See contracts §9.
- Verified 2026-11-08: 70 request-auth + 5 account-signin tests; live claim E2E on a fresh datadir
  (403 gated → OTP → admin session → config written → second email 403); mac arm64+x64 `.dmg` built
  locally; Linux x64 `.AppImage` + `.deb` built in an emulated container (CUA hash matches pin,
  AppImage extracts, deb metadata + payload verified). Windows builds on `windows-latest` CI
  (`package-win.yml`) — no local Windows toolchain.
- Pre-existing break fixed: `scripts/verify-linux-package.mjs` demanded `maximus:` SBOM prefixes
  while the pinned trycua archive ships `openmausbot:` ones — verifier now accepts both (values
  still exact-match). X11 input smoke + AppImage execution checks need real x64 (CI), not emulation.
- Gating follow-up fixed: session-less desktop loopback reported no `trust`, so the app window
  rendered a connected-looking app it could never load ("Connecting to your bots…" forever).
  `server/request-auth.ts` now reports `trust: "service"` (narrow scopes) for gated windows/shells
  while the main process keeps owner loopback — the window shows the sign-in screen. Covered by
  trust assertions in the desktop gate test; verified live (`/api/auth/session` → `trust: "service"`,
  `/api/bots` → 403) and by relaunching the rebuilt Mac app through claim to a working session
  (window text read over CDP: sign-in screen, then Inbox + Max after claim). Mac arm64+x64 dmgs and
  the Windows installer reshipped with the fix (x64 leg hung on a sick CDN; finished via mirror +
  `regenerate-mac-feed.mjs`). Linux AppImage/deb still carry the pre-fix server — refresh pending.
- Endpoint-picker reship (2026-11-08, verified): Mac arm64+x64 dmg+zip rebuilt with the picker
  (dev-signed, notarization off); packaged server booted from the .app proves the flow live
  (default production → `network_unavailable` → switch to local → OTP claim admin+client →
  persisted). Linux x64 AppImage + amd64 deb rebuilt in the emulated container with the fix
  inside (AppImage extracted at the real squashfs offset 944632 — the first `hsqs` at 194183
  is a runtime false positive; CUA hashes match linux-unpacked; deb payload + metadata verified;
  `latest-linux.yml` hashes match). AppImage execution + X11/CUA input smokes still need real
  x64 CI (`package-linux.yml`); the container runtime cannot exec the static-pie AppImage
  (`Exec format error`), so `verify-linux-package.mjs` stops at its `--appimage-offset` exec —
  everything before that step passed.
- Windows x64 built by cross-compile from macOS (no local Windows toolchain): sidecars staged with
  repo scripts where they allow it (browser `--target`, cloudflared/duckdb module entry points with
  platform overrides — all pinned bytes verified), CUA driver via a dev script (exe from the PyPI
  wheel, same 0.28.2 — GitHub's release CDN 504'd every Windows asset; sha recorded in build log),
  browser engine via dev override (upstream v0.37.0 win asset — the pinned vendor build lives at the
  not-yet-existing RELEASE_OWNER URL; sha `3345b957…0479` recorded). Built with
  `-c.win.signAndEditExecutable=false` (no wine: app exe keeps the default icon, installer branded)
  and a dev afterPack no-op (repo pins untouched). Dev-only deltas stay in `/tmp` scripts, never in
  repo pins. `Maximus-0.1.144-setup.exe` verified (MZ + Nullsoft marker, resources complete,
  `latest.yml` consistent). Production Windows still ships from `package-win.yml` CI.
- Name-collision fix: the default win zip (`Maximus-<v>-x64.zip`) is byte-identical to the mac x64
  zip name and overwrote it in a shared `release/` dir — win now emits `Maximus-<v>-win32-<arch>.zip`
  via platform `artifactName` (`electron-builder.yml`; per-target artifactName is schema-invalid).
  Mac x64 zip restored with ditto + `regenerate-blockmaps.mjs` + `regenerate-mac-feed.mjs` (feed verified).

## Flutter mobile plan

The app in `mobile/` already signs in, chats, approves, shows usage and billing, and opens the bot
computer. Scope stays a companion, not a desktop port. The phone pairs like any companion device
(pairing code + `x-maximus-companion-auth`) and can also sign in with email or a configured provider.
Pull requests that touch `mobile/` run `.github/workflows/mobile-smoke.yml` (analyze + `flutter test`).
Store signing and upload stay on the `maximus-mobile-v*` tag workflow. Promoting TestFlight or Play
internal to production is a store action.

- Phase 1 — read + approve: bots/threads/messages read, push for approvals, approve/deny cards,
  pairing flow, sign-in via email OTP. Reuses `GET /api/bots`, thread messages, pairing endpoints.
- Phase 2 — chat: send messages, threads, attachments upload, bot directory. Reuses bot message
  routes + upload endpoints with the companion token.
- Phase 3 — manage: seats/invites (owner), spend + allowance views, provider toggles. Reuses
  `/api/console/*` with the account token.
- Never on mobile: bot hosting, CUA drivers, browser engine, DuckDB, cloudflared — the phone is a
  remote control, heavy work stays on the desktop/server.
- Gating parity: the app signs in (companion session) before showing anything; admin/owner-only
  actions check the same scopes as the dashboard.
- Store work (owner-gated): Apple Developer + App Store Connect, Google Play console, bundle IDs,
  push credentials (APNs/FCM), store review assets. Start enrollments early — same lead time as
  the desktop certs.
- Suggested repo layout: `mobile/` (Flutter) beside `electron/`, sharing the OpenAPI-ish route
  shapes already exercised by `src/console/account.ts`; add a `mobile-smoke` CI lane hitting a
  staging harness.

## Local-dev runbook (2026-11-07, verified E2E)

- Worker: `cd cloudflare/control-plane && pnpm exec wrangler dev --config wrangler.local.jsonc --port 8787`
  (`wrangler.local.jsonc` mirrors `wrangler.jsonc` minus the production custom-domain `routes`: wrangler dev
  rewrites inbound Host/Origin to a custom-domain route, which breaks loopback + better-auth origin checks.
  Never deploy with the local file; `wrangler deploy` always uses `wrangler.jsonc`.)
- Harness: `MAXIMUS_CONTROL_PLANE_URL=http://127.0.0.1:8787 node --experimental-strip-types server/dev-server.ts`
  (port 8799). UI: `pnpm exec vite --port 5199 --strictPort`.
- First admin login (local dev): `MAXIMUS_SIGNIN_ADMINS="you@example.com" pnpm dev:server` enables the PairPage
  email sign-in (`/api/auth/email/start|verify`, admin+client scopes); afterwards manage people in Settings →
  People, which edits the same allow-list. `MAXIMUS_SIGNIN_MEMBERS` adds client-only logins the same way.
- Gated mode (require sign-in on localhost too): add `MAXIMUS_LOOPBACK_TRUST=service` to the harness command.
  `/` then shows the PairPage sign-in instead of the app, and app APIs 403 without a session, while email sign-in,
  pairing, and `/api/console/*` stay reachable. Verified 2026-11-07: session-less `GET /api/config` → 403, email OTP
  verify → `admin` session → 200.
- Full lockdown: add `MAXIMUS_REQUIRE_AUTH=1` alongside service trust. Session-less loopback then keeps only
  `GET /api/health`, `/api/auth/session`, `/api/edition`, `/api/brand` plus the self-authenticating
  `/api/internal/*` (capability Bearer [REDACTED] and testing capability key — both checked in-handler); every bot, thread,
  attachment, queue, search and config route needs a session (`SERVICE_ALLOW_STRICT` in `server/request-auth.ts`,
  covered in `server/request-auth.test.ts`). Without the flag, the shared-worker bot routes stay open as upstream
  designed. Verified 2026-11-07 live: session-less bots/tasks/messages/config/search → 403, email OTP → session →
  all 200.
- Public site shares one shell (`src/site/SiteShell.tsx`: sticky header with mobile menu, 4-column footer) across
  `/welcome`, `/pricing`, `/signin`, `/signup`, `/join`. Landing (`src/site/WelcomePage.tsx`): editorial hero, dark
  band with a hand-built labeled product mock + model strip, numbered 8-item capability list, menu map, FAQ, closing
  CTA. Pricing is production-grade (mausbot.com/pricing structure): live-catalog cards with featured plan, full
  comparison table (price, allowance, cap, feature union with included/not markers), 3-step billing explainer, 4-item
  pricing FAQ, dark closing CTA. Verified 2026-11-07: tsc + lint clean,
  site/console tests green, all five pages 200 live.
- Admin-managed plan catalog: `GET/POST/PUT /api/admin/plans` (`server/routes/plans.ts`, owner/admin) persist to
  `<datadir>/billing/plans.json` (`server/billing/plan-store.ts`) and override the `MAXIMUS_BILLING_PLANS` seed by id;
  the live maps update in place so pricing + billing + gateway see edits without a restart. Free is fully editable
  (owner choice 2026-11-07): a stored `free` row overrides the $0 builtin in pricing + billing + gateway; deleting the
  row restores the builtin. Seeded Team $20 + Business $50 to `~/.maximus/billing/plans.json`; `/pricing` renders all
  three tiers. Dashboard Plans view (`src/console/admin/PlansPage.tsx`): table + validated add/edit modal (id, name,
  price, allowance, cap, entitlement checkboxes, feature bullets), Free row editable like the rest. Verified
  2026-11-07: 27 plan tests (incl. stored-Free pricing view), live PUT free→pricing→restart-persistence on an isolated
  stack, live harness serves free+team+business. Worker catalog (2026-11-10): defaults follow the admin ration.
  Starter is $8 of Muse, Plus $22, Pro $40. The phone Plus product (`maximus_plus_monthly`) grants the team seat at
  the Plus ration, with `gateway`. The phone Pro product grants the business seat at the Pro ration. A Rates save
  pushes those rows to `PUT /api/operator/plans` when `MAXIMUS_OPERATOR_TOKEN` and the control plane URL are set.
  The one-time free grant stays on the harness wallet. The worker free row has no monthly allowance.
- Full admin dashboard `/admin` is a shell (`src/console/admin/Shell.tsx`: collapsible sidebar, sticky header, mobile
  drawer, logout) with six views (`?view=`, overview default; legacy `?leg=server` maps to users): Overview (metric
  cards, daily-usage sparkline, recent activity), Users (unified access/sessions/members table with search, sortable
  columns, pagination, empty/loading states; add/edit modal with allow-list validation; pairing codes), Workspace
  (existing hosted leg), Keys, Messages, Settings (bulk access editor + server info). UI kit in
  `src/console/admin/ui.tsx` (MetricCard, Sparkline, DataTable, Modal, states); all data from live APIs, fully typed.
  Verified 2026-11-07: tsc + lint clean, 34 console/admin tests, every view 200 on an isolated stack.
- Full admin dashboard `/admin` (superseded shell): two legs behind tabs (`?leg=server` deep-links the second). Workspace leg: hosted
  workspace admin over the console account token (existing). Server leg (`src/console/AdminHarness.tsx` +
  `src/console/harness.ts`, harness session cookie, admin-only): server health/edition, sign-in access lists
  (`/api/config` signIn), sessions + revoke, pairing codes (fresh code kept on top; the list API omits codes),
  per-user usage, provider keys via the settings `KEY_CATALOG` (status/save/remove through `/api/config`), bots →
  threads → read/send messages, and the server audit log. Non-admin sessions see a limited view; signed-out sees a
  sign-in prompt. Verified 2026-11-07 live (every read + write roundtrip) + 27 console/harness unit tests.
- Hosted console pages: `/signin` (email OTP → workspace picker), `/admin` (full dashboard for workspace admins:
  overview, seats/invites, provider toggles, spend history, routing, installations, audit; members get a limited
  read-only view). New API: `GET /api/auth/memberships` on the worker, `GET /api/console/memberships` proxy.
- Local `.dev.vars` (gitignored): `DEV_OTP_LOG=1`, `ALLOWED_ORIGINS=http://127.0.0.1:8787`, dev D1 IDs matching
  wrangler's public values; committed `DEV_OTP_LOG` stays `0`.
- Verified 2026-11-07: OTP start/verify (dev code from wrangler log) -> signup `local-dev` (free/admin) ->
  entitlements -> providers GET (5x BYO) -> kimi `{"mode":"off"}` reflected in routing -> invite -> spend ->
  admin seats; `/signup` `/join` `/pricing` all 200. Control-plane `tsc --noEmit` clean, prod `wrangler deploy
  --dry-run` clean.
- Service-endpoint picker (2026-11-08, verified live E2E): fixes the packaged-app
  `network_unavailable` dead end — users switch the sign-in service between Production
  (`https://accounts.maximus.com`), Local worker (`http://127.0.0.1:8787`), or a custom URL
  from the sign-in screen or Settings → Account, no env vars or restart needed. Verified
  2026-11-08 on a fresh `MAXIMUS_DESKTOP_PARENT=1` harness: default → production, email start
  fails `network_unavailable` (reproduces the report), switch to local → `{"ok":true}` → OTP
  claim → admin+client session, URL persisted to runtime config, invalid/unreachable customs
  rejected 400.
