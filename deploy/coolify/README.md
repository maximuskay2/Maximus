# Coolify + Docker Compose on one VPS

Stack: Postgres, accounts, accounts-cron, chat — Traefik labels on the
external `coolify` network. Env file lives only on the server:
`/opt/maximus/.env.production` (mode 600).

## Push from your laptop (one command)

Needs SSH to the VPS (`root@138.201.125.169` by default) and local `pnpm`.

```bash
pnpm deploy:vps
```

That builds `dist-server` + `dist`, rsyncs them, rebuilds the chat image, restarts
chat, and checks `https://app.meetnote.cc/api/health`.

When accounts changed too:

```bash
pnpm deploy:vps:accounts
```

Override host/paths with `MAXIMUS_VPS`, `MAXIMUS_VPS_SRC`, `MAXIMUS_VPS_ENV`,
`MAXIMUS_VPS_HEALTH`.

On the server only (after sources are already synced):

```bash
cd /opt/maximus/src/deploy/coolify
docker compose --env-file /opt/maximus/.env.production up -d --build
```

Root `.dockerignore` must not exclude `dist` / `dist-server` when building
`Dockerfile.chat` from the repo context (the VPS copy was patched for that).

## Free Muse (pooled key → gateway → Meta)

Chat needs these in `.env.production` (in addition to the admin Rates pool key):

| Var | Role |
| --- | --- |
| `MAXIMUS_WORKSPACE_PROVIDERS` | JSON: Muse `mode: "bundled"` + allowed models |
| `MAXIMUS_GATEWAY_TOKENS` | JSON: `{ "local": "maximus_workspace_<43 chars>" }` |
| `MAXIMUS_META_API_KEY` | Same workspace token (Meta driver Bearer → gateway) |
| `MAXIMUS_META_API_URL` | Loopback gateway base, default `http://127.0.0.1:8799/api/gateway/local/muse` |

Do **not** set `MAXIMUS_ADMIN_WORKSPACE` / `MAXIMUS_ADMIN_URL` / `MAXIMUS_ADMIN_MEMBERSHIP` on this product stack — those flip the chat into hosted “workspace portal” mode and block `/api/auth/signin`. Ration already bills the default workspace id `local`.

`Dockerfile.chat` installs Chrome’s Bookworm libraries so agent-browser under `/data` can start. Without them, `/api/bots/.../browser/live` returns 503 (`libglib-2.0.so.0` missing).

Example providers value:

```json
{"muse":{"mode":"bundled","models":["muse-spark-1.3-contributor","muse-spark-1.3"]}}
```

Generate the token once (`openssl rand -base64 32 | tr -d '=+/' | head -c 43`) and prefix `maximus_workspace_`. Do not put the Meta pool key in `MAXIMUS_META_API_KEY` — that stays in Admin → Rates (pool key).

## Sign in with Google, GitHub, Apple, Microsoft

A provider appears on https://app.meetnote.cc only when both its id and secret are set on the chat service. Register this redirect for each one:

`https://app.meetnote.cc/api/auth/oauth/<google|github|apple|microsoft>/callback`

Put the pairs in `/opt/maximus/.env.production`, then recreate chat:

`MAXIMUS_OAUTH_GOOGLE_CLIENT_ID` / `MAXIMUS_OAUTH_GOOGLE_CLIENT_SECRET`, and the same `MAXIMUS_OAUTH_*` pairs for `GITHUB`, `APPLE`, and `MICROSOFT`.

The accounts host is separate. Its buttons use `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and `GITHUB`, `APPLE`, `MICROSOFT`) and the redirect `https://accounts.meetnote.cc/api/auth/callback/<provider>`.

## Layout on the server

| Path | Purpose |
| --- | --- |
| `/opt/maximus/.env.production` | Secrets and compose env (mode 600) |
| `/opt/maximus/src/` | Build context (rsync target): `dist/`, `dist-server/`, `accounts/`, `deploy/coolify/` |
| `/opt/maximus/src/deploy/coolify/` | Compose project directory |
| Chat volume `/data` | `config.json`, sessions, bots, messages, billing, usage |

Public origins:

| Role | URL |
| --- | --- |
| App / chat | https://app.meetnote.cc |
| Accounts | https://accounts.meetnote.cc |
| Coolify UI | http://\<VPS\>:8000 |

## Sign-in allow list

Seed admins with `MAXIMUS_SIGNIN_ADMINS` (and optional `MAXIMUS_SIGNIN_MEMBERS`).
The first password account on a fresh volume is also owner. Members get
`client` only — they can chat; Usage and Your AI need `admin`.

## Health and logs

```bash
curl -sf https://app.meetnote.cc/api/health
cd /opt/maximus/src/deploy/coolify
docker compose --env-file /opt/maximus/.env.production ps
docker compose --env-file /opt/maximus/.env.production logs -f chat
```

## Latency (Muse)

Free **contributor** Muse is a reasoning model and is often slow even on short
prompts. Long threads add cost: set `context.compactAt` (token count) in
`/data/config.json` so folds happen before the window grows huge. Repo default
for multi-hundred-k windows is a 32k fold when `compactAt` is unset. Paid
`muse-spark-1.3` or BYO keys are faster.

## Related docs

- [Documentation hub](../../docs/README.md)
- [Architecture](../../docs/architecture.md)
- [VPS full-product roadmap](../../docs/plans/2026-11-11-vps-full-product-roadmap.md)
- Generic self-host (pair/tunnel, not this stack): [docs/deploy-vps.md](../../docs/deploy-vps.md)
