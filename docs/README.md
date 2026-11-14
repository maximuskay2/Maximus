# Maximus documentation

Maximus is a chat app where every conversation is an AI coworker: its own model,
thread, tools, and (optionally) computer. This folder is the technical manual.
The root [README](../README.md) is the product overview and quick start.

**Live product (this fork / MaximusBot):** [app.meetnote.cc](https://app.meetnote.cc) ·
[accounts.meetnote.cc](https://accounts.meetnote.cc)

---

## Start here

| If you want to… | Read |
| --- | --- |
| Understand the moving parts | [Architecture](architecture.md) |
| Run locally from source | [Root README → Quick start](../README.md#quick-start) |
| Self-host on a VPS (pair / tunnel / Tailscale / Docker+Caddy) | [Deploy on a VPS](deploy-vps.md) · [Self-hosting reference](self-hosting.md) |
| Deploy the **Coolify full product** (chat + accounts + billing) | [Coolify on one VPS](../deploy/coolify/README.md) |
| Push a laptop build to that VPS in one command | `pnpm deploy:vps` ([script](../deploy/coolify/push.sh)) |
| Verify a server change without touching live data | [Verification](verification/README.md) · [AGENTS.md](../AGENTS.md) |
| Ship the Flutter phone app | [mobile/README.md](../mobile/README.md) |
| Release desktop installers | [Releasing](releasing.md) |

---

## Repository map

```
├── src/                 Web UI (React + Vite) — chat shell
├── server/              Harness: HTTP/SSE API, drivers, turns, billing routes
├── shared/              Types and constants shared by web, server, mobile
├── electron/            Desktop shell (macOS / Windows / Ubuntu)
├── mobile/              Flutter companion (iOS + Android)
├── accounts/            Control-plane service (signup, OTP, workspace membership)
├── maximus-enterprise/  Source-available enterprise module (license, admin, gateway)
├── companion/           Companion relay / pairing helpers
├── cloudflare/          Control-plane + Composio broker workers
├── deploy/              Docker / Coolify / backup layouts
├── apps/docs/           Public docs site (MDX)
├── docs/                This manual (operators + contributors)
└── scripts/             Build, MCP, control-maximus, CI helpers
```

Default local ports: harness `8799`, webhook receiver `8800`, Vite app `5199`.
Data directory: `~/.maximus` locally, `/data` in the Coolify chat container.

---

## Product surfaces

| Surface | Path / URL | Notes |
| --- | --- | --- |
| Web app | `src/` → served from harness or Vite | Pairing or account sign-in |
| Desktop | `electron/` | Embedded harness; see [mac](mac-desktop.md) / [Windows](windows-desktop.md) / [Linux](linux-desktop.md) |
| Phone (native) | `mobile/` | Pairs to a server; default product origin in `shared/product-origin.ts` |
| Phone (PWA) | [phone-web-app.md](phone-web-app.md) | Home Screen install from Safari/Chrome |
| Accounts / signup | `accounts/` · accounts.meetnote.cc | OTP + OAuth; chat proxies some console routes |
| Admin / rates / gateway | enterprise + console UI | Pooled Muse key, plans, payment providers |
| MCP control plane | [mcp-server.md](mcp-server.md) | Bounded tools for Cursor / Claude Desktop |
| Headless CLI | [headless-cli.md](headless-cli.md) | `maximus run`, team apply, CI |

---

## Models and money

| Topic | Doc |
| --- | --- |
| Free / Muse / BYO plans | Coolify README · billing under `server/billing/` |
| Pooled Meta Muse gateway | [Coolify README → Free Muse](../deploy/coolify/README.md#free-muse-pooled-key--gateway--meta) |
| Custom CLIs and OpenAI-compatible endpoints | [custom-engines.md](custom-engines.md) |
| Context compaction (latency on huge windows) | [verification/context-compaction.md](verification/context-compaction.md) |
| Payments (Stripe / Paystack / Bachs) | `server/billing/` · [prod-infra.md](prod-infra.md) |
| Secret rotation | [secret-rotation.md](secret-rotation.md) |

**Sessions:** paired devices get scopes `admin` and/or `client`. Usage, engine
config, and most Settings mutations need `admin`. Member (client-only) sign-ins
can chat but cannot manage the home.

---

## Features (deep dives)

| Area | Docs |
| --- | --- |
| Engines / providers | [custom-engines.md](custom-engines.md) · [cursor.md](cursor.md) · [tool-selection.md](tool-selection.md) |
| Connected apps | [composio](composio.md) · [custom-mcp-servers.md](custom-mcp-servers.md) |
| Computer use | [computer-use-integration.md](computer-use-integration.md) · [bot-box.md](bot-box.md) |
| Voice / calls | [voice-mode.md](voice-mode.md) |
| Routines / waits | [proactive-routines.md](proactive-routines.md) · verification/waits |
| Rooms / teams | [team-sharing.md](team-sharing.md) · [org-library.md](org-library.md) |
| Files | [files.md](files.md) |
| Decision model (Jev) | [decision-model.md](decision-model.md) |
| Runtime contract | [runtime-contract.md](runtime-contract.md) |
| Analytics | [analytics.md](analytics.md) |

Verification recipes for each behaviour live under
[verification/](verification/README.md) — always use an isolated fixture.

---

## Operations

| Task | Doc / command |
| --- | --- |
| Coolify compose (meetnote) | [deploy/coolify/README.md](../deploy/coolify/README.md) |
| One-command deploy from laptop | `pnpm deploy:vps` or `pnpm deploy:vps:accounts` |
| Classic prod compose + Caddy | [prod-infra.md](prod-infra.md) |
| Generic VPS paths | [deploy-vps.md](deploy-vps.md) |
| CI job selection | [ci.md](ci.md) |
| Desktop release | [releasing.md](releasing.md) |
| Mobile store release | [mobile/STORE_RELEASE.md](../mobile/STORE_RELEASE.md) |
| Push notifications | [mobile/PUSH_SETUP.md](../mobile/PUSH_SETUP.md) |
| Enterprise license | [verification/enterprise-license.md](verification/enterprise-license.md) |

Env for Coolify lives only on the server: `/opt/maximus/.env.production` (mode 600).
Never commit filled secrets. Example templates: `deploy/.env.prod.example`,
`deploy/coolify` compose comments.

---

## Contributing

- Node **24+**, pnpm (see root `packageManager`).
- Comment policy and verification rule: [AGENTS.md](../AGENTS.md).
- Contracts / plans (historical and active): [plans/](plans/).
- Public site content: [apps/docs](../apps/docs/README.md).
- License: Apache-2.0 for the open tree; [maximus-enterprise/](../maximus-enterprise/) is separate ([LICENSING.md](../LICENSING.md)).

```sh
pnpm install
pnpm typecheck
pnpm test                  # full suite — prefer scoped vitest while iterating
pnpm control:maximus …     # drive an isolated fixture (see verification/)
```

---

## Roadmaps (this product line)

| Plan | Focus |
| --- | --- |
| [2026-11-14 Maximus v1 release](plans/2026-11-14-maximus-v1-release.md) | Freeze the current product and ship it. Later ERP / offline / Agent OS work is listed there and not scheduled |
| [2026-11-11 VPS full product](plans/2026-11-11-vps-full-product-roadmap.md) | Coolify + accounts + meetnote domains (hosting phases done) |
| [2026-11-12 Flutter chat parity](plans/2026-11-12-flutter-chat-parity-waves.md) | Mobile cards, share, phone apps, durability |
| [2026-11-10 LLM ration / billing](plans/2026-11-10-llm-ration-billing-roadmap.md) | Muse gateway metering |
| [2026-11-08 Flutter mobile](plans/2026-11-08-flutter-mobile-roadmap.md) | Phone app phases |
| [2026-11-06 Contracts](plans/2026-11-06-maximus-contracts.md) | Frozen product contracts |
