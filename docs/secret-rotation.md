# Maximus secret rotation

Every secret below travels by environment or mounted file only — never in the
repo, never baked into images, never pasted into chat. Names are placeholders;
values live with the owner (contracts s8). Rotate on the schedule shown, and
immediately on any suspected exposure (revoke first, then rotate).

## Inventory

| Secret (placeholder name) | Where it lives | Rotation |
|---|---|---|
| `MAXIMUS_MAC_CERT_P12_BASE64` / `MAXIMUS_MAC_CERT_PASSWORD` | GitHub repo secrets (release workflow) | Apple expiry (~5y cert, 1y provisioning); rotate within 30 days of expiry |
| `MAXIMUS_APPLE_API_KEY_P8_BASE64` / `MAXIMUS_APPLE_API_KEY_ID` / `MAXIMUS_APPLE_API_ISSUER_ID` | GitHub repo secrets | On role change or exposure; keys have no expiry |
| `MAXIMUS_WIN_CERT_PFX_BASE64` / `MAXIMUS_WIN_CERT_PASSWORD` | GitHub repo secrets | OV cert expiry (1–3y); rotate within 30 days of expiry |
| `MAXIMUS_UPDATE_FEED_TOKEN` (only if a private mirror is added) | GitHub repo secrets | 90 days, fine-grained PAT, releases-only |
| Stripe `MAXIMUS_STRIPE_SECRET_KEY` / webhook secret (live + test) | Harness env (`/etc/maximus/env`, mode 0600) | On staff change or exposure; test keys freely |
| Paystack `MAXIMUS_PAYSTACK_SECRET_KEY` / webhook secret | Harness env (mode 0600) | On staff change or exposure |
| OIDC client secret(s) | Control plane `wrangler secret` | Per issuer policy (commonly 90–180 days) |
| Bundled provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `MOONSHOT_API_KEY`, `META_API_KEY` on the gateway side) | Gateway env only, never in workspaces | 90 days, staggered per provider |
| `MAXIMUS_LICENSE_PRIVATE_KEY` (Ed25519, license issuance) | Offline file, mode 0600, two custodians | Never expires; rotate only on exposure (append the new public key to the verifier — never edit/remove live entries) |
| `MAXIMUS_SIGNIN_SMTP_URL` (contains the SMTP credential) | Compose `.env.prod` (mode 0600) | With the mail provider credential |
| Cloudflare API tokens (`CLOUDFLARE_API_TOKEN`, `..._MAXIMUS_SI`) | Control plane `wrangler secret` | 90 days or on scope change |

## Procedure (all secrets)

1. Create the replacement alongside the live one (new API key, new cert file,
   second `wrangler secret` version where supported).
2. Deploy it to staging first; prove the path still works (sign-in, checkout
   webhook replay, gateway turn, signed build — whichever the secret guards).
3. Promote to production: update the env file / repo secret / `wrangler
   secret`, restart only the service that reads it.
4. Revoke the old value at the issuer, then confirm production is still green
   (the old value must be dead, not merely unused).
5. Record the rotation (date, secret name, operator) in the ops log. Never
   record values.

## Emergency rotation (suspected exposure)

1. Revoke at the issuer immediately — do not wait for a replacement.
2. Rotate per the table; expect a brief outage on the guarded path.
3. Inspect audit logs for use of the exposed value (webhook deliveries,
   gateway spend spikes, unexpected installs).
4. File a post-mortem: how it leaked, what contained it, what prevents a
   repeat.

## Guardrails

- `wrangler secret put` for Worker secrets (never `vars`); the repo's
  `wrangler.jsonc` lists required names under `secrets.required` so a deploy
  cannot silently drop one.
- Compose env files are mode 0600, owned by the service account; `docker
  compose config` output is handled as secret-bearing.
- CI prints no secret values: signing steps fail closed with a naming error
  when a secret is unset, and key material is deleted from the runner in the
  same step that writes it.
