# Railway control plane roadmap

Who builds this is in [2026-11-10-team-execution-roadmap.md](2026-11-10-team-execution-roadmap.md). Tosin owns this spec.

Date: 2026-11-10. This replaces the Cloudflare Worker, D1, Email binding, tunnel API, and `cloudflared` packaging with services Railway can run. The HTTP paths the desktop, the phone, and the harness already call stay the same.

## Decision

Production is one Railway project.

| Service | What runs | Replaces |
| --- | --- | --- |
| Accounts | Long-running Node process, the current control-plane routes | Cloudflare Worker on `accounts.maximus.com` |
| Database | Railway Postgres | D1 `maximus-control-plane` |
| Chat server | Existing `cloud-home` image, port 8080, volume at `/data` | Fly home machine, and any plan that published a machine through a tunnel |
| Cron | Railway cron calls `POST /internal/cron` every five minutes with a shared secret | Worker `triggers.crons` |
| Mail | The accounts service sends SMTP. Railway stores the SMTP URL and the from-address. Railway does not send mail itself | `env.EMAIL` / `send_email` |
| Names | Hostinger (or any registrar) DNS points at the two Railway domains | Cloudflare custom domain `accounts.maximus.com` and per-machine `*.maximus.com` tunnel names |

Desktops and phones stay installable apps. They sign in and open chats against the Railway URLs. A computer at home is a client of the Railway chat server. It does not get its own public hostname.

## What leaves

These exist only to talk to Cloudflare. Delete them from the production path once the accounts service answers the same routes on Postgres.

- `cloudflare/control-plane/src/cloudflare-api.ts` tunnel and DNS calls
- Managed endpoint provision and delete (`/v1/installations/self/endpoint`)
- Tunnel capacity scan and the cleanup sweep in the Worker `scheduled` handler
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_TOKEN_MAXIMUS_SI`, account ids, zone ids, and `CLOUDFLARE_ENDPOINT_ACCOUNTS`
- `cloudflared` in the server image and the desktop package, for this production build
- `wrangler.jsonc`, `wrangler.local.jsonc`, and `wrangler dev` as the way accounts run
- The D1 binding, `env.EMAIL.send`, and `ctx.waitUntil`

Local development stops using port 8787. The accounts service listens on a local port against a local Postgres. `DEV_OTP_LOG=1` still prints the sign-in code instead of sending it. Production never sets that flag.

## What stays, on Railway

The route list in `cloudflare/control-plane/src/index.ts` is the contract. Same paths, same status codes, same error strings.

- Sign-up, session, and memberships. Better Auth runs in Node against Postgres. OTP stays 8 digits, 10 minutes, 5 attempts, stored hashed, rotated on resend, and limited to 5 sends per address per minute. The extra recipient limit in `otp-rate-limit.ts` stays.
- OTP mail uses the existing `TransactionalEmailSender`. The sender becomes SMTP (`SMTP_URL`, `EMAIL_FROM`). Subjects and the 10-minute body in `email.ts` stay. A failed send still returns an enumeration-safe response and logs only `transactional email send failed` plus the request id.
- Workspaces, invites, seats, tokens, provider toggles, entitlements, spend, audit, installations, and the operator plan catalog.
- OIDC SSO and the GitHub, Google, Apple, and Microsoft buttons. They appear only when that provider's client id and secret are set. Secrets stay in Railway variables.
- Apple and Google store verify, status, and webhooks. Stripe and Paystack stay on the harness billing routes they already use. Price ids stay in `MAXIMUS_STRIPE_PRICES` and `MAXIMUS_PAYSTACK_PLANS`. Store product ids stay the ids already in the stores.
- HighLevel start, callback, claim, and refresh. Those are HTTPS calls, not Cloudflare features.
- Phone push register, unregister, and send. APNs is HTTPS to Apple.
- Relay token issue, only if a later decision keeps a separate relay box. The default for this plan is that the phone talks to the Railway chat server, so the relay is off and `/v1/installations/self/relay-token` returns the same "relay disabled" result the config already has for `RELAY_DISABLED=1`.
- Health: `GET /api/health` and `GET /healthz`.

Background work that is not a tunnel moves to the cron request: delete expired Better Auth verifications. The request handler does not use `waitUntil`. It finishes the response, and the cron does the cleanup.

## Database

The 16 files in `cloudflare/control-plane/migrations/` are SQLite. Translate them forward into Postgres once. Do not edit an already-applied D1 file in place and call that the port. New migrations are Postgres-only and append-only.

D1 `prepare` / `batch` / `first` / `all` calls in the control-plane sources become one Postgres query helper with the same transactions the batches have today. Better Auth uses its Postgres adapter. `validateSchema` stays off, as it is now, because the migrations own the schema.

Tables that exist only for tunnels (`managed_companion_endpoints` and the tunnel-capacity rows) are not created in Postgres.

## Chat server on Railway

Build the Docker target `cloud-home`. Railway routes HTTPS to port 8080. Mount a volume at `/data`. Set at least 2 CPUs, 4 GB RAM, and 512 MB shared memory so a bot browser can run. The plain server image listens on `127.0.0.1` only, so Railway's proxy cannot use it.

Set `MAXIMUS_CONTROL_PLANE_URL` to the accounts service's Railway URL. Set `MAXIMUS_PUBLIC_URL` to the chat server's public URL. Set `MAXIMUS_CLOUD_EDGE_TRUSTED_PROXIES` to Railway's proxy range so the client address used for pairing lockout is the real client.

One chat server is the production machine for this plan. Per-customer Fly apps are out of scope here.

## Client and admin behavior

No new screens. The web admin, the desktop, and the phone already call the accounts URL from settings. Production default becomes the Railway accounts URL. A custom URL still overrides it.

`/v1/installations/self/endpoint` goes away. Creating an installation records the install. It does not create a DNS name or a tunnel. The UI that offered a tunnel hostname shows the Railway chat URL instead.

Sign-in from the admin and the product keeps both doors that exist today: the harness session for that server, and the hosted account session. Both hit the Railway accounts service for the email code.

## Build order

1. **Postgres and the Node process.** Boot the accounts routes on Node with a Postgres connection string. Health returns 200. No Worker types remain on this process.
2. **Auth and mail.** Email OTP, OAuth, and OIDC pass the current control-plane tests against Postgres. SMTP sends the four existing messages. `DEV_OTP_LOG=1` still prints locally.
3. **Workspaces through billing.** Seats, invites, plans, entitlements, store webhooks, push, and HighLevel pass on Postgres. Operator catalog push still updates the same plan rows.
4. **Remove Cloudflare.** Delete the tunnel routes, the Cloudflare API client, the tunnel cron, and the production dependency on `cloudflared` and Wrangler. Cron is the verification cleanup only.
5. **Railway project.** Accounts service, Postgres, cron, and the `cloud-home` chat service. Domain names from the registrar point at Railway. Secrets listed below are set there and nowhere in the repo.
6. **Cut over.** Desktop, phone, and harness default to the new accounts URL. A sign-in code arrives by email. A paired client opens a chat on the Railway chat URL. The Worker is left undeployed.

## Secrets the Railway accounts service needs

`BETTER_AUTH_SECRET`, `DATABASE_URL`, `SMTP_URL`, `EMAIL_FROM`, `CRON_SECRET`, OAuth client secrets for each enabled provider, Apple and Google billing secrets, HighLevel client secret, and `RELAY_TOKEN_SIGNING_KEY` only if the relay stays on. The Cloudflare API tokens are not copied over.

## Done when

- An isolated Postgres, not a live Railway database, runs the translated migrations and the current control-plane route tests with no `cloudflare:test` or D1.
- A real SMTP mailbox delivers an 8-digit sign-in code, and a wrong code still fails closed.
- The chat image on Railway serves the web app and `/api/health` on the public URL, and a browser signed in against the accounts service can open it.
- Nothing in the production deploy reads `CLOUDFLARE_API_TOKEN`, starts `wrangler`, or shells out to `cloudflared`.
- Desktop and phone builds still install from their stores. This plan does not sign them and does not create Stripe or Paystack products.
