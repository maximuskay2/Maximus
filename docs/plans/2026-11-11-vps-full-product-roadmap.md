# VPS full-product roadmap (accounts + chat + billing + enterprise)

Date: 2026-11-11. **Hosting phases 0–5 are done.** The release that freezes
this product and lists the remaining client and driver work is
[2026-11-14 Maximus v1](2026-11-14-maximus-v1-release.md).



Goal: run the **whole** MaximusBot product on the **same VPS**
(`138.201.125.169`), not chat-only pairing. Users sign up, buy a plan, and
use the full app (web / Flutter / desktop). Coolify is the preferred
orchestrator on that box. A short Maximus domain is wired later; until then
the stable public URL is the VPS hostname we already serve.

This replaces the “pair to a raw Hetzner box” interim path as the customer
product. Pairing remains an admin/dev escape hatch, not the signup funnel.

## Decisions

| Decision | Choice |
| --- | --- |
| Host | One VPS for everything (accounts, Postgres, chat, cron, Caddy/Coolify) |
| Orchestration | Coolify on the VPS; clean and reinstall if the current chat-only unit fights Coolify |
| Public URL now | Hetzner hostname already live: `https://static.169.125.201.138.clients.your-server.de` (DNS A → `138.201.125.169`). Prefer this over a bare IP for HTTPS certificates. |
| Public URL later | Maximus product domain (e.g. `accounts.` / `app.` on your registrar) → same VPS IP; no app rewrite if clients use a config “product base URL” |
| Billing | Turn on; admin can enable/disable each gateway independently |
| Gateways | Keep existing (Paystack admin toggle today; Stripe/catalog paths already in tree). **Add** [Bach’s developer portal](https://app.bachs.io/developer/portal) as another provider option |
| Enterprise | Issue `max1.…` license; set `MAXIMUS_LICENSE_KEY` on chat so paid entitlements unlock |
| Clients | Flutter + desktop talk to the **product URL** (accounts + workspace), not a one-off pair link to the raw host |

## Current state (honest)

| Piece | Status |
| --- | --- |
| Chat harness on VPS (`systemd` `maximus`, Caddy HTTPS) | Live on the Hetzner hostname |
| `/signup` UI + `accounts/` control plane | In repo; **not** deployed → “account service is unreachable” |
| `maximus-enterprise/` | In local tree + private GitHub `maximuskay2/maximus-enterprise`; on VPS build logs: *enterprise layer present but `MAXIMUS_LICENSE_KEY` is not set* |
| Paystack admin toggle | Implemented (`payments.json` / Rates admin) |
| Bach’s gateway | **Not** integrated yet — roadmap work |
| Flutter/desktop product URL | Still oriented at pair / self-host; needs product base URL |

## Target topology (same VPS)

```
Internet
   │
   ▼
Coolify / Caddy  (80/443 on 138.201.125.169)
   ├── accounts.<host>   → accounts service :8791   (signup, OTP, plans, billing webhooks)
   ├── app.<host>        → chat harness :8799       (workspace UI + API)
   └── (optional) coolify UI on a private path/port

Postgres          → accounts only (Coolify managed volume)
accounts-cron     → POST /internal/cron every 5m (Bearer CRON_SECRET)
chat data volume  → /home/maus/.maximus or Coolify volume at /data
```

Until the short domain exists, both public names can be the same host with
path or subdomain on the Hetzner hostname, or a single host with accounts on
an internal URL and the chat proxying console routes (match how the harness
already expects a control-plane base). Prefer **two hostnames** once DNS is
yours; until then keep one HTTPS name and set `BETTER_AUTH_URL` /
`MAXIMUS_CONTROL_PLANE_URL` / `MAXIMUS_PUBLIC_URL` to that name’s paths or
subdomains Coolify exposes.

## Phases

### Phase 0 — Reset or absorb (same day)

1. Snapshot / backup anything on the VPS you care about (none expected beyond
   the chat unit we installed).
2. **Option A (preferred if Coolify will own ports 80/443):** stop and disable
   the hand-rolled `maximus` unit, install Coolify, re-deploy chat + accounts
   as Coolify apps.
3. **Option B:** keep current chat unit, install Coolify only for accounts +
   Postgres on other ports, put Coolify’s proxy in front later. Higher risk of
   port fights — only if we must avoid downtime.
4. Stable public name for now:
   `https://static.169.125.201.138.clients.your-server.de`
   Document this as `PRODUCT_PUBLIC_ORIGIN`. Bare IP alone is not the HTTPS
   name; the PTR hostname is the durable stand-in until Maximus DNS.

### Phase 1 — Accounts on the VPS (signup works)

1. Deploy `accounts/` (Dockerfile `accounts/Dockerfile`) via Coolify.
2. Attach Postgres; set:
   - `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`
   - `ALLOWED_ORIGINS` (app origin)
   - `EMAIL_FROM`, `SMTP_URL` (required for real OTP mail)
   - `CRON_SECRET`, `MAXIMUS_OPERATOR_TOKEN`
3. Cron service or Coolify scheduled task → `POST /internal/cron`.
4. Health: `GET /api/health` → control-plane JSON.
5. Point chat at accounts: `MAXIMUS_CONTROL_PLANE_URL` (or harness equivalent)
   so `/signup` stops returning `console_unavailable`.
6. Verify: open `/signup` → email → code → workspace created.

Reference shapes: `deploy/railway-accounts.md` (same env vars; host is Coolify
on this VPS instead of Railway).

### Phase 2 — Chat under Coolify + enterprise license

1. Move chat into Coolify (same image/build we rsynced: `dist-server` + `dist`,
   or build from repo on the box).
2. Volume for data; `MAXIMUS_STATIC_DIR`; Node 24.
3. **Issue and set enterprise license** (see section below).
4. Confirm health /edition shows enterprise entitlements when key is set.
5. Keep pair codes for break-glass admin only; product path is signup.

### Phase 3 — Billing (admin toggles)

1. Turn on catalog / plans already in accounts + console pricing.
2. **Existing — keep as toggles:**
   - Paystack (`paystackEnabled` + `ngnPerUsd` in admin Rates / `payments.json`)
   - Any Stripe / store paths already in the tree (leave off until keys exist)
3. **New — Bach’s:** integrate [Bach’s developer portal](https://app.bachs.io/developer/portal)
   as a provider behind the same admin “gateways” UI:
   - `bachsEnabled` (or equivalent) admin switch
   - secrets only in Coolify env / `payments.json`-style private store
   - checkout + webhook → same plan entitlement path as Paystack
4. Admin can enable/disable each gateway anytime without redeploying clients.
5. No invented secrets in git; operator pastes Bach’s / Paystack keys in Coolify.

### Phase 4 — Domain cutover (later, no client break)

1. Register/point Maximus (or your) domain A/AAAA → `138.201.125.169`.
2. In Coolify: add `accounts.<domain>` and `app.<domain>` certificates.
3. Update env: `BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `MAXIMUS_PUBLIC_URL`,
   `MAXIMUS_CONTROL_PLANE_URL`.
4. Clients keep using **one configured product base URL** (see Phase 5). Changing
   DNS does not require a new pair ritual.

### Phase 5 — Flutter + desktop → product URL

1. Ship a single **product base URL** (default = current VPS HTTPS origin;
   override later to short domain).
2. Auth: accounts session (signup/signin), then open workspace — not
   `maximus://pair` as the default onboarding.
3. Pairing link remains for self-host / support.
4. Desktop “Add server” / Flutter server field: prefilled or documented as the
   product origin so IP/hostname changes under DNS don’t strand users who
   already use the stable config key.

## How to issue the enterprise license

Keys are `max1.<claims>.<signature>` (Ed25519). Scripts live in
`maximus-enterprise/scripts/`. Private key **never** goes in the repo.

### 1) One-time: signing keypair (operator machine, offline-ish)

```bash
# From the repo root on a trusted machine — NOT committed
node maximus-enterprise/scripts/keygen.mjs --out ~/secure/maximus-license-signing.key
```

- Writes the **private** PEM at that path (mode `0600`).
- Prints a **public** key (base64url `x`) to bake into
  `maximus-enterprise/license.ts` → `LICENSE_PUBLIC_KEYS` (append to rotate;
  never remove a live entry).
- Production public key `eO_dY7V4x4PW71QSBj-U9-V7Kyi-KTFQob2Twv3A3pM` is
  already in tree (generated 2026-11-07). If you still have that private key,
  skip keygen and issue with it. If the private key is lost, generate a new
  pair, append the new public key, rebuild chat, then issue new customer keys.

### 2) Issue a customer / production key

```bash
node maximus-enterprise/scripts/issue-license.mjs \
  --key ~/secure/maximus-license-signing.key \
  --customer "MaximusBot production" \
  --features whitelabel,sso,admin,budgets,billing,gateway \
  --issued 2026-11-11 \
  --expires never
```

Feature ids (from `maximus-enterprise/FEATURES`):

- `whitelabel` — brand overrides  
- `sso` — OIDC  
- `admin` — Installations + hosted sign-in adapter  
- `budgets` — spend cap  
- `billing` — sell prices / billable usage  
- `gateway` — managed gateway routing  

The script prints one line: `max1.…` — that is `MAXIMUS_LICENSE_KEY`.

### 3) Set it on chat (VPS / Coolify)

```bash
# Coolify: service env for chat
MAXIMUS_LICENSE_KEY=max1.…

# Or systemd Environment= / EnvironmentFile= (if still on the unit)
# Then restart chat
```

Restart chat after setting. Without the key the server stays OSS edition even
though `maximus-enterprise` is present in the bundle. With a valid key,
`entitled(id)` gates unlock for the features listed in the claims.

### 4) Ops hygiene

- Store the PEM only on the operator machine or a secrets vault (0600).
- Treat `MAXIMUS_LICENSE_KEY` like a password in Coolify.
- Re-issue before expiry if not `never`; grace/warn behaviour is in
  `maximus-enterprise/license.ts`.

## Milestone checklist

- [x] Phase 0: Coolify on VPS; ports 80/443 owned cleanly (`http://138.201.125.169:8000`)  
- [x] Phase 1: accounts + Postgres on Coolify network; OTP via `DEV_OTP_LOG=1` until SMTP  
- [x] Phase 2: chat under compose + Traefik; `MAXIMUS_LICENSE_KEY` set; enterprise entitlements on  
- [x] Phase 3: Bach’s provider + admin toggle in code; Paystack toggle kept (paste `BACHS_*` / Paystack secrets to enable live checkout)  
- [x] Phase 4: `app.meetnote.cc` + `accounts.meetnote.cc` → VPS; Coolify env updated  
- [x] Phase 5: Flutter `EndpointPreset` + desktop `DEFAULT_COMPANION_CONTROL_PLANE_URL` → meetnote (`shared/product-origin.ts`) — **rebuild clients for release**  

### Live origins

| Role | URL |
| --- | --- |
| Coolify UI | http://138.201.125.169:8000 |
| App / chat | https://app.meetnote.cc |
| Accounts | https://accounts.meetnote.cc |
| Compose | `/opt/maximus/src/deploy/coolify` + `/opt/maximus/.env.production` |

## Out of scope for this roadmap

- Railway as the primary host (optional later mirror; not required)  
- Deleting the private `maximus-enterprise` GitHub repo  
- Inventing Bach’s API credentials in git  

## Ops today

Phases 0–5 above are live. Day-to-day deploy from a laptop:

```bash
pnpm deploy:vps              # chat image
pnpm deploy:vps:accounts     # when accounts/ changed
```

Manual: [deploy/coolify/README.md](../../deploy/coolify/README.md) ·
docs hub: [docs/README.md](../README.md).
