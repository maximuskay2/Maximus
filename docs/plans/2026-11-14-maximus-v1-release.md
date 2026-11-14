# Maximus v1 release lock

Date: 2026-11-14. Baseline: `0.1.144` in the root `package.json`.

Code for the two open gaps is in tree: the phone reconnects `/api/events`
(`mobile/lib/chat/thread_page.dart`, `mobile/lib/api/live_events.dart`) and
the Meta HTTP driver retries transient failures (`retryScale` on
`server/drivers/meta.ts`). A streamed partial still ends the turn, the same
rule as Grok, so a retry cannot append a second copy of that text. The
manual passes in sections 1, 4, 5, and 6 are still open.

This is the release plan for the product that already exists: one harness,
three clients, many engines. Hosting for that product is done. See
[2026-11-11 VPS full product](2026-11-11-vps-full-product-roadmap.md) (phases
0–5 checked off: Coolify, Postgres, accounts, chat, `app.meetnote.cc`,
`accounts.meetnote.cc`).

A later product (ERP schema, offline outbox, QuickBooks/Tally/POS bridges,
office-PC command routing, enterprise RBAC beyond today’s workspace roles)
is not scheduled here. It would sit beside this tree, in
`maximus-enterprise/` or its own module, and would call this harness. This
release does not add those tables or those bridges.

## Who this release is for

Developers, power users, and small teams who want one chat for several model
engines, local computer use on the desktop, custom MCP tools, and multi-step
work that keeps running on the server after the window closes.

Release line: **Maximus — the multi-engine workspace.** It runs on your
desktop, opens in the browser and on the phone against the same server, and
runs multi-step work with an approval card in front of anything risky.

Public origins stay `https://app.meetnote.cc` and
`https://accounts.meetnote.cc` (`shared/product-origin.ts`).

## Frozen feature set

Ship these. Do not add surfaces to make the list longer.

| Surface | In this release | Already in tree |
| --- | --- | --- |
| Engines | Claude, Codex, Grok, Gemini, Muse Code, OpenAI-compatible (Ollama, LM Studio, DeepSeek, Groq, OpenRouter, and any `/v1` chat server), custom ACP CLI | `server/drivers/builtIn.ts` |
| Clients | Web (`src/`, React 19 + Vite 7 + Tailwind 4), desktop (Electron 43, embedded harness), phone (Flutter) | One HTTP API + `GET /api/events` |
| Desktop power | macOS and Ubuntu Xorg GUI control via the bundled CUA driver, in-app Chromium over CDP, local stdio MCP server so Cursor or Claude Desktop can drive the team | `docs/computer-use-integration.md`, `docs/mcp-server.md`. Ubuntu Wayland host control stays off |
| Inline UI | `show_widget` and `show_html` on web and desktop. Phone keeps the confirm/cancel card it already draws | `shared/widget.ts`, `src/components/widget/`, `src/components/app/`, `mobile/lib/chat/widget_card.dart` |
| Work that outlives the tab | Turns run on the harness. Closing the browser or the phone drops the subscriber. The turn continues. A restart reruns a cut turn once unless it already sent, posted, or paid | `server/runtime/` |
| Keys and tools | BYO keys and CLI logins. Custom MCP servers (URL or local command). Pooled Muse through the in-process gateway | `docs/custom-engines.md`, `docs/custom-mcp-servers.md` |
| Host | One VPS, Coolify, Postgres for accounts, chat volume at `/data`, `pnpm deploy:vps` | `deploy/coolify/README.md` |

Phone widgets stay title, text, and confirm/cancel. Full widget trees and
HTML mini-apps stay on web and desktop. That split is the release, not a bug
to close in v1.

## What is already done (do not rebuild)

- **Search isolation.** `/api/search` runs on a read-only worker
  (`server/message-search-worker.ts`). The event loop is free while the scan
  runs. Writes, event logging, and backups stay on the main thread on
  purpose. See `docs/verification/persistence-performance.md`.
- **Web live stream.** `src/lib/live-events.ts` reconnects with backoff
  (500 ms to 10 s), a `since=` cursor, and a 40 s stale timeout. A missed
  cursor asks for a snapshot.
- **Transient retries on the main chat drivers.** Claude, Codex, Grok, Muse
  Code, and the OpenAI chat runtime (which OpenAI-compatible endpoints use)
  already emit `turn.retrying` for a classified transient failure.
- **Phone read cache.** `mobile/lib/api/thread_cache.dart` is a 32 MB
  stale-while-revalidate cache (threads 30 minutes, bot list 5 minutes). It
  is a display cache. It is not an offline queue, and v1 does not turn it
  into one.
- **Hosting phases 0–5** on the meetnote VPS.

## Release work

Each item has a gate. A gate is a command or a check on an isolated fixture
or on staging. Do not point mutation tests at the live meetnote data
directory. Follow `docs/verification/README.md`.

### 1. Prove the frozen set on all three clients

One scripted pass, same account, same bot:

1. Sign in on the web at `app.meetnote.cc` (or a staging twin).
2. Send a turn on Claude or Muse, then switch that bot to an
   OpenAI-compatible model and send another turn. The second turn must
   carry the thread, not only the latest line.
3. On desktop, assign the bot to this computer, grant Accessibility and
   Screen Recording, and complete one approved GUI action on macOS and on
   Ubuntu Xorg. Confirm Wayland still refuses host control and says so.
4. From Cursor or Claude Desktop, complete one read and one send through
   the local Maximus MCP server (`docs/mcp-server.md`).
5. On web and desktop, `show_widget` press and `show_html` click both come
   back as the person’s next message
   (`docs/verification/widgets.md` and the chat-app tests).
6. On the phone, open the same thread, send a message, and settle a
   confirm/cancel card. Leave the full widget tree as text fallback if the
   phone cannot draw it.

Done when those six pass on a build cut from one commit, and the phone
build’s version matches the root `package.json` (`mobile/tool/sync_version.dart`).

### 2. Phone stream survives a dropped network

Web already resumes. The phone now does too: a dropped socket reconnects
with the web backoff, sends the last cursor as `since`, and reloads the
thread when the server says that cursor was not replayed. A 401 or 403
ends the sign-in instead of looping.

Confirm with one drill:

- Airplane mode, then radio back, on a thread that received messages while
  the phone was offline: the thread shows those messages and the composer
  still sends. No red screen, no duplicate send of the optimistic row.

Do not add a write outbox. A send that fails while offline stays a failed
send with a retry button, which the thread page already surfaces as
`_sendError`.

### 3. One retry gap, then a drill

The Meta HTTP driver now sets `retryScale` and uses the OpenAI chat
classifier (`server/drivers/retry.ts`): a 429, 502, 503, 529, or connection
reset retries up to three times and emits `turn.retrying`; auth, an unknown
model, and quota fail on the first attempt. An interrupt during the wait
cancels the turn. Once assistant text has streamed, the turn fails instead
of retrying, so the partial is not sent a second time.

Then run one fake-engine drill per primary driver (Claude, Codex, Grok,
Muse Code, OpenAI-compatible, Meta): a single injected 529 completes the
turn, and a bad key fails on the first attempt. The August 2026
harness-upgrade note that said the conversation path had no retry is stale
for every driver except Meta.

### 4. Leave SQLite writes on the main thread

The search worker is the v1 answer to the event-loop stalls. The remaining
items in `docs/verification/persistence-performance.md` are measurements
(write and log tail under disk contention, long-history hydration, backup).
Run `pnpm bench:persistence` once on a quiet machine and attach the numbers
to the release notes.

Move message writes off the main thread only if that run shows a
user-visible stall on a normal send. Keep the rule already written there:
commits stay durable, acknowledged only after the transaction, and are never
fire-and-forget.

### 5. Production host checklist

The compose path is the product. This pass confirms the running VPS matches
it. Use staging or a fresh Coolify stack for anything that writes.

- `curl -sf https://app.meetnote.cc/api/health` returns the harness JSON.
- `GET` on the accounts health URL returns the control-plane JSON.
- Signup sends a real OTP or completes OAuth. Production env must not set
  `DEV_OTP_LOG`. Phase 1 of the VPS plan allowed that flag until SMTP
  existed; v1 removes it from the production env file.
- A new account can open a thread and finish one Muse or BYO turn.
- `pnpm deploy:vps` from a clean tree rebuilds chat and the health check
  passes afterwards. Accounts deploy (`pnpm deploy:vps:accounts`) only when
  `accounts/` changed.
- Desktop and phone release builds use `shared/product-origin.ts`. Pairing
  stays available for self-host and support. It is not the default
  onboarding on the meetnote builds.
- Backups: one restore drill from `docs/prod-infra.md` onto a **fresh**
  volume, then `PRAGMA integrity_check` on `messages.db`. Never restore over
  the live volume.

Billing gateways that are already behind admin toggles (Paystack, Bach’s)
stay off until the operator pastes keys. v1 does not add a gateway.

### 6. Cut the release

Follow `docs/releasing.md` for desktop (macOS arm64 and Intel, Windows,
Ubuntu) and `mobile/STORE_RELEASE.md` for the stores. One version number
across `package.json` and the Flutter pubspec. Publish only after the six
checks in section 1 and the phone reconnect drill have passed on that
commit.

Release notes name the product as above, list the engines, and state the
two limits a user will hit: the desktop app must be open for local computer
use, and the phone draws confirm/cancel cards rather than HTML mini-apps.

## Held for a later product

Recorded so v1 pull requests can reject them. No dates, no design.

- `erp_*` tables, customers, products, inventory, invoices.
- An offline mobile or web outbox that syncs mutations later.
- Connectors for QuickBooks, Sage, Tally, or a local POS.
- A router that runs a command on a chosen office PC and returns the result
  to the phone. Today the phone runs work on whichever harness it is signed
  into (the cloud home, or the desktop while that app is open and awake).
- Tenant isolation beyond the current workspace row in Postgres and the
  single chat data directory per installation.
- Railway as a replacement for the Coolify VPS.
- Full ChatKit widget trees and `show_html` frames inside Flutter.
- Ubuntu Wayland host control.

`maximus-enterprise/` stays the license gate it already is (whitelabel, SSO,
admin, budgets, billing, gateway). Turning those features on for a paying
workspace is an operator step with `MAXIMUS_LICENSE_KEY`. It is not a
second product in this release.
