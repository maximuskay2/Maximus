# Railway accounts project runbook

Production topology from the Railway control-plane plan. The product manager
opens this step; the owner supplies the secrets and the domains. Nothing here
runs until then. Creating the project bills the owner's Railway workspace.

## Topology

| Service | Source | Notes |
| --- | --- | --- |
| `accounts` | Dockerfile `accounts/Dockerfile`, repo root context | Node + Postgres, port 8791, health `/api/health` |
| `Postgres` | Managed Postgres | Isolated production database |
| `accounts-cron` | Same Dockerfile, cron schedule | Calls `POST /internal/cron` every 5 minutes |
| `chat` | Image `ghcr.io/<RELEASE_OWNER>/maximus-cloud-home:railway` | Tunnel-free tag from `docker.yml`, port 8080, volume `/data` |

## 1. Create the project and services

```bash
railway init --name maximus --workspace "<owner workspace>"
railway add --service accounts --json
railway add --database postgres --json
railway add --service accounts-cron --json
railway add --service chat --json
railway service list --json
```

## 2. Point the services at their sources

```bash
railway environment edit --service-config accounts build.builder DOCKERFILE
railway environment edit --service-config accounts build.dockerfilePath accounts/Dockerfile
railway environment edit --service-config accounts deploy.healthcheckPath /api/health
railway environment edit --service-config accounts-cron build.builder DOCKERFILE
railway environment edit --service-config accounts-cron build.dockerfilePath accounts/Dockerfile
railway environment edit --service-config accounts-cron deploy.cronSchedule "*/5 * * * *"
railway environment edit --service-config chat source.image ghcr.io/<RELEASE_OWNER>/maximus-cloud-home:railway
```

`accounts-cron` builds the accounts image and runs only its start command on
schedule. If the GHCR package is private, connect the GitHub integration to
the project first so Railway can pull it.

## 3. Set the accounts variables

Generate the secrets; they live only in Railway, never in the repo.

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -base64 32   # CRON_SECRET
openssl rand -base64 32   # MAXIMUS_OPERATOR_TOKEN
```

| Key | Value |
| --- | --- |
| `PORT` | `8791` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | generated, at least 32 characters |
| `BETTER_AUTH_URL` | `https://accounts.<domain>` |
| `ALLOWED_ORIGINS` | `https://<app-domain>` |
| `EMAIL_FROM` | `noreply@<domain>` |
| `SMTP_URL` | owner SMTP, for example `smtps://user:pass@smtp.resend.com:465` |
| `CRON_SECRET` | generated, at least 16 characters |
| `RELAY_DISABLED` | `1` |
| `MAXIMUS_OPERATOR_TOKEN` | generated; the harness needs the same value for catalog push |
| OAuth | `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, and the same pairs for Google, Apple, Microsoft, only for providers to enable |
| Store billing | `APPSTORE_*` / `GOOGLE_*` only when store billing is on |
| HighLevel | `HIGHLEVEL_CLIENT_ID`, `HIGHLEVEL_CLIENT_SECRET`, `HIGHLEVEL_REDIRECT_URL`, `HIGHLEVEL_SCOPES` only when the relay is used |
| SSO | `MAXIMUS_OIDC_CLIENT_SECRET` only when SSO is on |

Set each with stdin for secrets:

```bash
printf "%s" "<secret>" | railway variable set BETTER_AUTH_SECRET --stdin --service accounts
railway variable set DATABASE_URL='${{Postgres.DATABASE_URL}}' --service accounts
```

Never set on this project: `CLOUDFLARE_API_TOKEN` or any `CLOUDFLARE_*`
tunnel variable, `DEV_OTP_LOG`, `MAXIMUS_CLOUD_TUNNEL_TOKEN`.

## 4. Set the cron variables and command

```bash
railway variable set ACCOUNTS_URL='http://accounts.railway.internal:8791' --service accounts-cron
printf "%s" "<same CRON_SECRET>" | railway variable set CRON_SECRET --stdin --service accounts-cron
railway environment edit --service-config accounts-cron deploy.startCommand "node -e \"fetch(process.env.ACCOUNTS_URL+'/internal/cron',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""
```

Use the accounts service's private domain for `ACCOUNTS_URL`; confirm the
exact host with `railway private-network status --service accounts --json`.

## 5. Set the chat variables, volume, and size

```bash
railway variable set MAXIMUS_CONTROL_PLANE_URL='https://accounts.<domain>' --service chat
railway variable set MAXIMUS_PUBLIC_URL='https://chat.<domain>' --service chat
railway variable set MAXIMUS_CLOUD_EDGE_TRUSTED_PROXIES='<railway proxy range>' --service chat
```

Attach a volume at `/data` and size the service to at least 2 CPUs and 4 GB
RAM in the dashboard. Container browsers already pass
`--disable-dev-shm-usage`, so no shared-memory setting is needed. Never set
`MAXIMUS_CLOUD_TUNNEL_TOKEN` on this service.

## 6. Domains

```bash
railway domain --service accounts --json
railway domain --service chat --json
```

Add the registrar domains after DNS is ready, then point
`BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `MAXIMUS_CONTROL_PLANE_URL`, and
`MAXIMUS_PUBLIC_URL` at them:

```bash
railway domain accounts.<domain> --service accounts --json
railway domain chat.<domain> --service chat --port 8080 --json
```

## 7. Verify

```bash
curl -sf https://accounts.<domain>/api/health
curl -sf https://chat.<domain>/api/health
railway logs --service accounts-cron --lines 20 --json   # exit 0 every 5 minutes
```

Then sign in from a browser against the accounts service, confirm the code
arrives by SMTP, and open a chat on the chat URL. A wrong code must fail
closed. Confirm no production service references Cloudflare:

```bash
railway variable list --service accounts --json | grep -i cloudflare && echo LEAK || echo clean
railway variable list --service chat --json | grep -i cloudflare && echo LEAK || echo clean
```

## Cutover and handoff to Lanre

Lanre owns the clients. Hand him the production accounts URL. The picker
probes it and reads these statuses:

| Probe | Expect |
| --- | --- |
| `GET /api/health` | 200 `{ ok: true, service: "maximus-control-plane", contractVersion: 1 }` |
| OTP send unknown address | 200 `{ success: true }`, enumeration-safe |
| OTP sign-in, wrong code | 400 `{ error: "invalid_otp" }` |
| OTP sign-in, expired code | 400 `{ error: "otp_expired" }` |
| Rate-limited send | 429 `{ error: "rate_limited" }` |
| Tunnel endpoint route | 404 `{ error: "not_found" }`; the UI shows the chat URL instead |

Rollback is the picker: point the clients back at the previous accounts URL.
The Worker code stays in the repo, so it can be redeployed if the cutover
must be reversed.
