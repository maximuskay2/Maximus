# Maximus integration contracts (frozen)

Companion to `2026-11-06-maximus-takeover-roadmap.md`. All five tracks build
against this file. Any change restarts the affected tracks' track-done.
Nothing here is code — Track 2/3/4 implement from it.

## 1) Brand token mapping (old -> new)

| Old | New (frozen) | Notes |
|---|---|---|
| `OpenMausBot` (product) | `Maximus` | `DEFAULT_BRAND.name`, window/menu/tray, installer names |
| `MausBot` (short name) | `Max` | Bot/tool display short name; only `Maximus`/`Max` ship |
| `openmausbot` (package, lower) | `maximus` | `package.json` name, CLI, slugs, lowercase identifiers |
| `com.openmausbot.app` (appId) | `com.maximus.app` | `electron-builder.yml` appId, `desktopName` |
| `openmausbot://` (protocol) | `maximus://` | Protocol scheme, install links |
| `OMB_` (env prefix) | `MAXIMUS_` | Full cutover, no compat shim (roadmap assumption) |
| `OMB_DATA_DIR` / `~/.openmausbot` | `MAXIMUS_DATA_DIR` / `~/.maximus` | First-boot copy-then-verify import; source left intact |
| `omb1.` (license prefix) | `max1.` | See section 3 |
| `omb_workspace_` (token prefix) | `maximus_workspace_` | See section 7 |
| `omb-managed-*` (model tags) | `maximus-managed-*` | Managed-model model-id prefixes |
| Updater `milind-soni/OpenMausBot` | `<RELEASE_OWNER>/Maximus` | Owner confirms; `latest-mac.yml` + `latest.yml` ship every release |
| `ghcr.io/milind-soni/openmausbot` | `ghcr.io/<RELEASE_OWNER>/maximus` | Prod image; `maximus-local:latest` for compose dev |
| `openmausbot-podman` | `maximus-podman` | Podman overlay |
| `OpenMausBot-domain-check` (UA) | `Maximus-domain-check` | Custom-domain check User-Agent |
| `OpenMausBot-packager` (UA) | `Maximus-packager` | Packager User-Agent |
| `/.well-known/openmausbot/environment` | `/.well-known/maximus/environment` | Environment descriptor |
| `/.well-known/openmausbot/domain-check/` | `/.well-known/maximus/domain-check/` | Domain-ownership challenge |
| `@openmausbot/docs` / `docs.openmausbot.com` | `@maximus/docs` / `docs.<MAXIMUS_DOMAIN>` | Docs package + site; domain from owner |
| `x-omb-hosted-contract-version` | `x-maximus-contract-version` | See section 6 |
| `X-Omb-Hosted-Model-Policy` | `X-Maximus-Model-Policy` | Managed-model policy header |

Exceptions to the purge: `LICENSE`, `NOTICE`, `third_party/` attribution,
and the `~/.openmausbot` -> `~/.maximus` migration shim. Proof:
`rg -li 'openmausbot|mausbot'` clean outside those.

## 2) Final entitlement ID set

Shipped day one (all gated in core from day one):

- `whitelabel` — brand.json overrides (name, tagline, accent, logo, supportUrl, favicon)
- `sso` — OIDC sign-in with scope mapping (greenfield)
- `admin` — Settings -> Installations + hosted sign-in adapter
- `budgets` — workspace monthly spend cap, refusing turns at the cap
- `billing` — sell prices per model; billable column in Usage + CSV
- `gateway` — LLM-included (bundled) routing through the managed gateway

Invariants (kept from upstream): unknown entitlement ids grant nothing;
keys may carry unshipped ids. Gate interface stays
`entitled()` / `editionStatus()` / `createWorkspaceAccess()` /
`hostedWorkspaceConfiguration()` in `server/enterprise.ts`; new layer lives
in `maximus-enterprise/` (proprietary), upstream `enterprise/` deleted.

## 3) License key format (spec only, no code)

- Shape: `max1.<claims>.<signature>` — base64url JSON claims; Ed25519
  signature over the UTF-8 bytes of `<claims>`; `MAXIMUS_LICENSE_KEY` carries it.
- Claims (JSON): `v` (literal `1`), `customer` (non-empty string, shown in UI
  + startup log), `features` (entitlement id array, section 2; unknown ids
  carried, never rejected), `issued` (`YYYY-MM-DD`), `expires` (`YYYY-MM-DD`
  or `null` for perpetual).
- Keys: fresh Ed25519 keypair, ours alone; public keys baked into the
  verifier (append to rotate, never edit/remove live entries); private key
  outside the repo (file mode 0600), never in chat or images. New
  keygen/issue tooling mirrors the old `issue-license.mjs` discipline.
- Policy: warn at 30 days before expiry (`MAXIMUS_LICENSE_WARN_DAYS = 30`);
  7-day grace after expiry (`MAXIMUS_LICENSE_GRACE_DAYS = 7`); expiry mid-run
  degrades at grace end without restart; every failure degrades to free
  edition with a notice naming the fix. Verification is offline.

## 4) Provider roster + switchboard

Day-one roster is exactly these provider ids (frozen strings):

- `claude` (Claude), `codex` (ChatGPT/Codex), `grok` (Grok),
  `kimi` (Kimi), `muse` (Muse)

Unknown provider ids grant nothing and hide everywhere. Kimi rides its
OpenAI/Anthropic-compatible protocols; Muse rides the Muse Code CLI as a
spawned agent and/or the Meta Model API compatible protocols; exact
endpoints/tiers/model ids pinned at build time from official docs and
recorded in code comments.

Switchboard — three levels, evaluated top-down (first "off" wins, with reason):

1. `operator` — global kill-switch per provider id. Storage: operator config
   (env/file on the control plane). API: `PUT /api/operator/providers/{id}`
   `{ enabled: bool, reason?: string }`; `GET /api/operator/providers`.
2. `workspace` — admin enable/disable per provider + assigned-model catalog
   (extends the `hosted-models.ts` assignment-policy pattern to all five
   providers + BYO instances). Storage: workspace record on the control
   plane; enforced at selection time. API:
   `PUT /api/workspaces/{id}/providers/{providerId}`
   `{ mode: "byo" | "bundled" | "off", models: string[] }`;
   `GET /api/workspaces/{id}/providers`.
3. `bot` — per-bot model choice in the existing picker. Storage: bot record.
   Off/unassigned providers hide with a reason; unassigned-model selection is
   rejected with the managed error.

BYO traffic uses user credentials directly (never metered/billed); bundled
traffic routes via section 7. Mixed mode per provider allowed in one workspace.

## 5) Webhook event schema (Stripe + Paystack)

Events (frozen names):

- `billing.checkout_completed` — pay -> grant entitlements
- `billing.subscription_updated` — plan/allowance change -> re-sync
- `billing.subscription_cancelled` — cancel/expire -> grace -> free tier
- `billing.payment_failed` — failed payment -> grace + banner
- `billing.payment_recovered` — recovery after failure -> clear banner

Payload (JSON, both payment providers normalized to this):

- `event_id` (provider's event id, string), `type` (one of the above),
  `created_at` (ISO-8601), `provider` (`"stripe"` | `"paystack"`),
  `livemode` (bool), `workspace_id`, `customer_id`,
  `plan` (catalog id), `entitlements` (id array, section 2),
  `allowance` (monthly model-spend allowance, minor currency units or null).
- Delivery: `POST /api/billing/webhook/{stripe|paystack}` with cryptographic
  signature verification; test-mode fixtures recorded for replay tests.
- Idempotency key: `{provider}:{event_id}` — duplicate deliveries are
  acknowledged without re-applying; grant/revoke are instant; billing state
  never destroys user data.

## 6) Control-plane contract version + endpoints

- `MAXIMUS_CONTRACT_VERSION = 1`; header `x-maximus-contract-version`;
  omitted version accepted only for the v1 payload (same legacy policy as
  before); mismatch fails `409`/`503` with `MAXIMUS_CONTRACT_MISMATCH` —
  never a silent downgrade.
- Frozen endpoint list (control plane, `cloudflare/control-plane` or
  replacement stack; migrations forward-only either way):
  - `GET /api/health`
  - Auth: `POST /api/auth/signup`, `/api/auth/invite`, `/api/auth/oidc/*`,
    `POST /api/auth/revoke`
  - Workspaces: `GET|PUT /api/workspaces/{id}`,
    `GET|PUT /api/workspaces/{id}/providers` (section 4),
    `GET /api/workspaces/{id}/entitlements`, `GET /api/workspaces/{id}/spend`
  - Operator: `GET|PUT /api/operator/providers` (section 4)
  - Gateway: `/api/gateway/{workspace}/*` (section 7)
  - Billing: `POST /api/billing/checkout`,
    `POST /api/billing/webhook/{stripe|paystack}` (section 5)
  - Admin console: `/api/admin/seats`, `/api/admin/installations`,
    `/api/admin/audit`, `/api/admin/usage`
  - Device/edge (kept shapes): relay, push, tunnel-capacity, installations
    endpoints as in the current control plane.

## 7) Managed gateway route shape

- Base: `{admin-origin}/api/gateway/{workspace}` (`{workspace}` matches
  `^[a-z][a-z0-9-]{1,30}$`).
- Routes: `{base}/{provider}/{...upstream-path}` where `{provider}` is a
  section-4 id; upstream path mirrors the provider's native API.
- Auth: per-workspace token `MAXIMUS_HOSTED_MODEL_TOKEN`, format
  `maximus_workspace_<43 base64url chars>`; catalog in
  `MAXIMUS_HOSTED_MODELS` (JSON: per-provider assigned native model ids,
  deduped, max 100 each, max 64 KiB).
- Enforcement: selection-time — only assigned models selectable; unassigned
  rejected with the managed error; BYO credentials never sent to the
  gateway; bundled provider keys never exposed to workspaces. Metering via
  `server/usage-ledger.ts`, caps via `server/spend.ts` (`spend_cap` 409 on
  cap-exceeded); allowance-exhausted -> overage at our sell prices.

## 8) Owner secrets/assets checklist

Procure before the release gate; all via environment/files, never in repo:

- [ ] Apple Developer enrollment + Developer ID cert; notarization credentials
- [ ] Windows Organization Validation cert (SmartScreen-clean publisher)
- [ ] Release repo: `<RELEASE_OWNER>/Maximus` created; updater feed tokens
- [ ] Provider accounts + bundled keys: Anthropic, OpenAI, xAI, Moonshot
      (Kimi tier: standard vs highspeed), Meta (Muse tier: Spark vs Wonder)
- [ ] Stripe keys (live + test) and/or Paystack keys; region/currency split
- [ ] OIDC issuer + client credentials; scope mapping sign-off
- [ ] Ed25519 license signing key (generated at issue-tooling setup, 0600)
- [ ] Brand artwork: mac `.icns` + entitlements, Windows `.ico` + metadata,
      Linux icons + `.desktop`, PWA/manifest assets, logo/favicon sources
- [ ] Domains: app, docs (`docs.<MAXIMUS_DOMAIN>`), control plane, gateway
- [ ] Payments/tax/compliance sign-off (invoicing, refunds, regional rules)
- [ ] Free-tier shape decision: trial vs feature-limited free vs paid-only

## 9) Desktop auth model (decided 2026-11-08)

- Installed apps gate loopback like the gated web: `service` trust + strict by default
  (`server/request-auth.ts`, `MAXIMUS_DESKTOP_PARENT=1`).
- Recovery hatches (local only): `MAXIMUS_LOOPBACK_TRUST=owner` and/or `MAXIMUS_REQUIRE_AUTH=0`.
- Fresh install (empty allow-list, no sessions) offers first-user claim: the first email that
  verifies an OTP becomes owner and lands in Settings → People (`server/account-signin.ts`).
  Headless servers stay fail-closed — the operator seeds `MAXIMUS_SIGNIN_ADMINS/MEMBERS`.
- The app window carries the desktop capability below JS but, without a session, may only use
  the strict service routes; the Electron main process keeps full token powers.
- Marketing downloads (`/welcome#download`) serve `release/` builds over `GET /api/downloads`
  + `/api/downloads/file/<name>` (`server/routes/downloads.ts`, allow-listed, unauthenticated).
- Packaged apps resolve the control plane to `https://accounts.maximus.com` unless
  `MAXIMUS_CONTROL_PLANE_URL` is set — the domain + worker deploy gates production sign-in.
- Service-endpoint picker (shipped 2026-11-08): resolution order env → saved
  setting (`controlPlaneUrl` in runtime config) → packaged default; an empty or
  invalid value disables hosted features, never silently re-points. `GET|POST
  /api/auth/endpoint` (`server/routes/endpoint.ts`) reads/switches the endpoint:
  presets `production` (clear to default) and `local` (`http://127.0.0.1:8787`),
  or a custom URL (https, or http only on loopback; probed before save —
  `endpoint_invalid`/`endpoint_unreachable` 400s). Switches apply live with no
  restart (`clientURL` tracking in `server/account-signin.ts` +
  `server/routes/console.ts`). Picked from PairPage, SigninPage, and Settings →
  Account (`src/console/ServiceEndpoint.tsx`); read-only with an env-managed
  notice when `MAXIMUS_CONTROL_PLANE_URL` is set.
