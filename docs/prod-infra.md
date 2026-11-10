# Maximus production infrastructure

Fresh-host boot, staging vs production, backups, and the margin dashboard.
Companion to [secret rotation](secret-rotation.md) and the frozen
[contracts](plans/2026-11-06-maximus-contracts.md). All secrets travel by
environment/files only — nothing secret is committed or baked into images.

## Layout

| File | Purpose |
|---|---|
| `deploy/docker-compose.yml` | Base: one tenant (server on loopback + Caddy) |
| `deploy/compose.prod.yml` | Production overlay: pinned image, limits, logs, backups |
| `deploy/compose.staging.yml` | Staging overlay: same shape, smaller caps, short retention |
| `deploy/Caddyfile.prod` | Hardened edge: TLS 1.2+, HSTS preload, security headers |
| `deploy/backup/backup.sh` | Nightly volume snapshot + retention prune |
| `deploy/.env.prod.example` | Placeholder env (copy to `.env.prod`, never commit filled) |

## Fresh VPS boot (production)

1. Point `app.<MAXIMUS_DOMAIN>` at the host (A record), open ports 80/443.
2. Install Docker, copy the deploy files, configure:
   ```sh
   git clone https://github.com/<RELEASE_OWNER>/Maximus && cd Maximus/deploy
   cp .env.prod.example .env.prod
   nano .env.prod   # RELEASE_OWNER, MAXIMUS_VERSION, DOMAIN, sign-in emails, SMTP
   ```
3. Start and verify:
   ```sh
   docker compose -f docker-compose.yml -f compose.prod.yml --env-file .env.prod up -d
   docker compose -f docker-compose.yml -f compose.prod.yml ps   # maximus "healthy"
   curl -sf https://app.<MAXIMUS_DOMAIN>/api/health   # {"app":"maximus",...}
   curl -sI https://app.<MAXIMUS_DOMAIN>/ | grep -i strict-transport-security
   ```
4. Mirror `/backups` off-host (the `backups` volume holds the snapshots; the
   sidecar only writes them — see "Backups").

Staging is the same with `compose.staging.yml`, `.env.staging`, and
`DOMAIN=staging.<MAXIMUS_DOMAIN>` — on an isolated host, never sharing the
prod data volume.

## Staging vs production

| | Production | Staging |
|---|---|---|
| Compose files | `docker-compose.yml` + `compose.prod.yml` | `docker-compose.yml` + `compose.staging.yml` |
| Image | `ghcr.io/<RELEASE_OWNER>/maximus:<version>` | `...:staging` |
| Domain | `app.<MAXIMUS_DOMAIN>` | `staging.<MAXIMUS_DOMAIN>` |
| CPU / RAM cap | 4 vCPU / 8 GB | 2 vCPU / 4 GB |
| Backup retention | 14 days | 3 days |
| Edge | `Caddyfile.prod` (both) | `Caddyfile.prod` (both) |

The release gate, money proof, and backup/restore drill all run on staging
before the prod deploy.

## TLS and health

- Caddy terminates TLS with `protocols tls1.2 tls1.3`, HSTS preload
  (`max-age=63072000; includeSubDomains; preload`), `nosniff`, `DENY`
  framing, a closed `Permissions-Policy`, and no server banner.
- `/api/health` is the liveness probe (Compose healthcheck, orchestrators,
  load balancers). It is unauthenticated by design and answers only
  `{ app, pid, static, capabilities }`.
- `/hooks/*` proxies to the webhook receiver (per-hook secrets); everything
  else proxies to the app with SSE streaming (`flush_interval -1`).

## Backups

The `backup` sidecar mounts the data volume read-only and runs
`deploy/backup/backup.sh` on `BACKUP_SCHEDULE` (default 03:00 UTC): it writes
`maximus-backup-<UTC stamp>.tar.gz` to the `backups` volume (modes preserved,
so keys stay 0600), verifies the archive, then prunes snapshots older than
`BACKUP_RETENTION_DAYS`.

Off-host mirror (run from cron on the host or a second machine):

```sh
docker cp maximus-prod-backup-1:/backups/. /srv/maximus-offhost/   # then rclone/restic out
```

### Restore drill (run on staging before every release)

```sh
# 1. Stop the stack, keep the volumes.
docker compose -f docker-compose.yml -f compose.staging.yml down
# 2. Restore the snapshot into a FRESH data volume (never over live data).
docker volume rm maximus-staging_data
docker volume create maximus-staging_data
docker run --rm -v maximus-staging_data:/data -v maximus-staging_backups:/backups:ro \
  alpine:3.21 tar -xpzf /backups/maximus-backup-<stamp>.tar.gz -C /data
# 3. Boot and verify integrity + health.
docker compose -f docker-compose.yml -f compose.staging.yml up -d
curl -sf https://staging.<MAXIMUS_DOMAIN>/api/health
```

The drill passes when the restored stack boots, `/api/health` is green, and
spot-checked SQLite files report `ok` under `PRAGMA integrity_check`.

## Margin dashboard

`GET /api/admin/usage/margin?from=YYYY-MM-DD&to=YYYY-MM-DD` (admin only, plus
a `.csv` twin) reports per-provider bundled spend vs customer charges:

- `providerCostUsd`: our provider spend (reported row cost first, vendor rate
  card fallback). BYO rows never enter it.
- `billedUsd`: charges at our sell prices. Null without a sell price list.
- `marginUsd` / `marginPct`: the per-provider margin. Negative margin blocks
  public pricing for that model (contracts: sell must exceed cost everywhere).
- `unpriced` / `unbilled`: bundled turns missing a cost or a sell price —
  investigate before trusting the margin.

Unknown providers appear under `other` so no spend hides. Reconcile against
provider invoices and the usage ledger before each pricing change.
