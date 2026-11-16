<div align="center">

<img src="public/bull-avatar.png" alt="Maximus bull" width="220">

# Maximus

**One account. A team of AI coworkers. The browser, your computer, and your phone.**

[**app.meetnote.cc**](https://app.meetnote.cc) &nbsp;·&nbsp; [Download](https://app.meetnote.cc/welcome#download)

<img src="docs/assets/brand/social-bull.png" alt="Maximus — the bull" width="900">

<sub>Maximus is a chat where every conversation is an AI coworker with its own job, its own model, and its own thread. Sign up once at <a href="https://app.meetnote.cc">app.meetnote.cc</a>. That account opens in the browser, the desktop app, and the phone. Also known as <strong>Max</strong>; formerly <strong>OpenGrokBot</strong>. An independent project. Not affiliated with xAI, Meta, OpenAI or Manus.</sub>

You choose how the models are paid for, once: **free** to start, **your own key** if you already pay for Claude, ChatGPT, Grok, or another model, or **Muse** when you want Maximus to provide the model. The next browser, computer, or phone continues with that choice.

Talk to the bots like contacts. Watch them work. Approve what matters.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-macOS%20%C2%B7%20Windows%20%C2%B7%20Ubuntu-2B2E3A?logo=electron&logoColor=9FEAF9)
![Agents](https://img.shields.io/badge/agents-Claude%20·%20Codex-d97757)

<br>

<a href="https://app.meetnote.cc">
  <img src="https://img.shields.io/badge/%E2%86%97%EF%B8%8F%20%20Open%20app.meetnote.cc-1084fe?style=for-the-badge&labelColor=070707" alt="Open Maximus at app.meetnote.cc" height="40">
</a>
&nbsp;
<a href="https://app.meetnote.cc/welcome#download">
  <img src="https://img.shields.io/badge/%E2%AC%87%EF%B8%8F%20%20Desktop%20%26%20phone-2a9d8f?style=for-the-badge&labelColor=070707" alt="Desktop and phone download on meetnote" height="40">
</a>

<br>
<br>

<sub>Powered by <a href="https://maxit.com.ng">maxit.com.ng</a></sub>
<br>
<a href="https://maxit.com.ng">Maximus Infotech</a>

</div>

---

> ⚠️ **No affiliation with any cryptocurrency.** Maximus has no token. Any coin using the Maximus, Maus, or SupaMaus name is not created, endorsed, or affiliated with this project or its maintainer. I have received no tokens, payment, or allocation from anyone, and I will not be endorsing any token.

## Why

Maximus keeps each coworker in its own conversation: its own personality, its memory of that thread, its model, and the apps it can use. The hosted app is [app.meetnote.cc](https://app.meetnote.cc). The same code also runs on your own machine.

- **One account.** The browser, the desktop app, and the phone share the sign-in, the threads, and the plan you already chose: free, your own key, or Muse.
- **Bring your own agents.** On your own machine, bots can run on the `claude`, `codex`, and `grok` CLIs you already have. Point any engine at a custom CLI binary in **Settings → Engines**.
- **Yours to run.** A self-hosted server keeps transcripts, keys, and events in `~/.maximus`.
- **Agents with hands.** Each bot can use a cloud Linux desktop, an isolated Local VM, or—where the platform
  safety boundary is currently certified—your own computer, plus 500+ apps through Composio. Host control is
  available on macOS and Ubuntu GNOME (Xorg and Wayland) after explicit opt-in. Non-GNOME Wayland sessions stay
  unavailable.

## The open-source alternative to Grok Bot, Muse, dots and Cue

Four closed personal-agent products shipped in seven weeks of 2026, and each one keeps the model, the
computer and your data on its maker's side of the line. Maximus is the open-source version of that
shape: a team of agents in a chat app, each with its own model, its own computer and its own connected
apps, running on your machine under Apache 2.0. If you searched for an *open Muse*, *open dots*, an
*open-source Grok Bot*, an *open Instinct* or an *open Cue*, this is the repository.

| Looking for | What it is | How Maximus differs | Read more |
| --- | --- | --- | --- |
| **Open source Grok Bot** | xAI's roster of bots on one shared cloud computer, Grok only, from a SuperGrok or Cursor plan | Same roster shape; any model per bot; your own machine; approval cards | [Grok Bot vs Maximus](https://app.meetnote.cc) |
| **Open Muse** | Meta's single personal agent in a Meta cloud VM, US and Canada only | A team instead of one agent; runs anywhere; data in `~/.maximus` | [Meta Muse alternative](https://app.meetnote.cc) |
| **Open dots** | OpenAI's always-on agent inside ChatGPT, GPT only, Pro and Business Premium plans | Several agents; your Claude, ChatGPT or Grok login; no plan required | [OpenAI dots alternative](https://app.meetnote.cc) |
| **Open Cue** | Manus's invite-only agents with their own phone, email and wallet | No invite; OAuth instead of passwords; open source | [Cue by Manus alternative](https://app.meetnote.cc) |
| **Open Instinct** | Spear Street's invite-only agent that holds your passwords on a cloud computer | Ask for approval when you want it; signs in over OAuth; your machine | [Instinct AI alternative](https://app.meetnote.cc) |

All five side by side: [Muse vs Grok Bot vs Dots vs Cue](https://app.meetnote.cc),
and a decision guide in five questions: [Which AI agent should I use?](https://app.meetnote.cc)

## Features

- **Pick a brain per bot.** A model picker with a provider rail — Claude and Codex models side by side, defaults marked, unavailable providers dimmed with the reason. Switch a bot's model mid-conversation.
- **Every bot gets a computer.** Open the Computer panel and the bot's cloud desktop spins up on its own — live screen preview while it works, or point the bot at this Mac instead.
- **Bots ask before they act.** Shell commands, file edits, and questions surface as inline cards — Allow / Deny / answer in chat.
- **Connected apps.** A one-click marketplace over Composio: Gmail, Slack, GitHub, Notion, Linear and hundreds more.
- **Manage bots like chats.** Pin, mark unread, edit profile, duplicate, hide, delete — agents behave like contacts.
- **Keys once, everything lights up.** Paste credentials in App Settings; they persist locally and the provider fleet hot-reloads.

### #️⃣ Channels for every context

Keep Work, Personal, and each project in separate channels without cloning your bots. Every channel has
its own transcript, shared instructions, working folder, responder rules, and editable bot roster. File a
channel and its bots under a named context, then rename it or change its members whenever the team changes.

### ⚡ Fast decisions with Jev

Add a TypeSafe Jev key, or an OpenRouter key and model, in **Settings → Decision model** and rooms set to **Auto** pick the bot
that fits each un-mentioned message in a few hundred milliseconds, falling back to the room's lead whenever the decision model is off or unsure.
See [docs/decision-model.md](docs/decision-model.md).

### 📦 Install a complete team from one Markdown file

Browse outcome-driven teams on [BotMRR](https://botmrr.io), then choose **Add to Maximus**. The app
opens a review screen before creating the bots, Chief of Staff, channels, playbooks, connector checklist,
and suggested routines. You can also import the same `.md` file from disk or paste its public GitHub URL
in **Teams → Import**.

The format stays portable: Maximus reads the structured YAML frontmatter for a reliable one-click
install, while Grok, Claude, ChatGPT, and people can follow the ordinary Markdown playbook. Connections
remain off until you approve them, routines arrive paused, and packages never carry credentials,
conversations, permissions, memory, or computer access. Browse portable team playbooks on [BotMRR](https://botmrr.io) (Markdown + YAML frontmatter).

### 🤝 Share a whole department

Right-click a department and choose **Share department…** (or use **Templates → Share**) to save the whole department as one
file: its bots with their instructions, pictures and skills, group chats, routines, shared instructions,
Chief of Staff, connection slots and each bot's starter notes (untick them to leave them out). The dialog
shows exactly what the file holds before you save it. Chat history, keys and passwords, model choices and
computers never go in, and anything that looks like a secret is removed from the text. Whoever imports it
gets new bots on Ask, skills switched off and routines paused. See [docs/team-sharing.md](docs/team-sharing.md).
Desktops connected to an organization also get **Templates → From {Organization}**: the packages its Admin shares,
added with one click, skills switched on. See [docs/org-library.md](docs/org-library.md).
Your New bot defaults can travel too, as a **preset bot** that appears in New bot (in a team file, or on
their own with **Share as preset…**). See [docs/presets.md](docs/presets.md).

### 🎧 Bots that talk back

Press the speaker on any reply, or switch a bot to read its answers out as they land — so you can listen
to what ran overnight while you make breakfast. Hit **call** and it's a conversation: it hears you, tells
you what it's doing while it works, and asks for approvals out loud.

Choose ElevenLabs, Fish Audio, Grok (xAI), built-in Mac voices, or a local Chatterbox server in an agent profile. Paste a
cloud key once when needed, pick a voice, and every bot can talk.
Give a bot its own voice and a channel stops sounding like one person.

For Grok, save your xAI API key in **Settings → Connections**, then choose **Grok (xAI)**
and a voice under the bot’s **Voice & alerts**. It reuses that host-side key and returns MP3
audio for spoken replies and calls. Language is detected automatically from the reply text;
quality varies outside xAI’s [officially supported languages](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech).
This adds speech synthesis to the existing call flow; microphone transcription remains unchanged.

**Also in the box:** streaming replies with tool-run activity chips · dictation from the
composer mic (on-device Apple speech recognition on macOS, Fish Audio speech-to-text on Windows and Linux, in the desktop app) · SupaMaus cursor mascots with role-aware
expressions · screenshots of the bot's work folded into the transcript.

## Powered By

<div align="center">

![Claude](https://img.shields.io/badge/Claude-d97757?logo=claude&logoColor=white)
![Codex](https://img.shields.io/badge/Codex-000000)
![Grok](https://img.shields.io/badge/Grok%20CLI-000000?logo=x&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=9FEAF9)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-0F172A?logo=tailwindcss&logoColor=38BDF8)
![Composio](https://img.shields.io/badge/Composio-e6493a)
![Boat](https://img.shields.io/badge/Boat-sponsor-111111)
![Cua](https://img.shields.io/badge/Cua%20Driver-1f2937)
![ElevenLabs](https://img.shields.io/badge/ElevenLabs-000000?logo=elevenlabs&logoColor=white)
![Fish Audio](https://img.shields.io/badge/Fish%20Audio-2563eb)
</div>

| Service | Purpose |
|---|---|
| **Claude · Codex · Grok** | The agents behind every bot, run through their local CLIs |
| **Electron** | Desktop shells for macOS, Windows, and Ubuntu |
| **React + Vite + Tailwind CSS** | The chat app UI and its build |
| **Boat** ([boat.dev](https://boat.dev)) | Each bot's cloud computer |
| **Maximus Infotech** ([maxit.com.ng](https://maxit.com.ng)) | Product host · powered by |
| **Composio** | Connected apps — Gmail, Slack, GitHub, and more |
| **Cua Driver** | Native computer use on your own machine |
| **ElevenLabs · Fish Audio** | Hosted voices for bots that talk back |

## How it works

Two processes. The app holds no transports of its own — it sends typed commands over HTTP and folds one SSE
event stream into state. The harness server owns every agent process and normalizes each provider's native
protocol into one canonical runtime event stream (logged per-thread as NDJSON).

```mermaid
flowchart LR
    subgraph app ["App — React + Tailwind (5199)"]
        UI[Chat UI · model picker · computer panel]
    end
    subgraph server ["Harness server (127.0.0.1:8799)"]
        REG[Driver registry] --> BUS[Event bus → SSE]
        BROKER[Permission broker]
    end
    subgraph agents ["Agents on your computer"]
        CL[claude CLI]
        CX[codex CLI]
        GR[grok CLI]
    end
    UI -- "HTTP commands" --> server
    BUS -- "one SSE stream" --> UI
    REG --> CL & CX & GR
    CL & CX & GR -- "permission requests" --> BROKER
    server -- "Boat API" --> BOAT[("Cloud computer<br/>boat.dev")]
    server -- "Composio Session" --> APPS[("Gmail · Slack · GitHub · …")]
```

| Layer | Where | What it does |
|---|---|---|
| Drivers | `server/drivers/` | One per provider: Claude, Codex, and Grok Build over their local CLIs (stream-JSON / JSON-RPC / ACP), plus a cloud-computer agent. Unknown drivers degrade to "unavailable", never crash the fleet. |
| Harness | `server/harness/` | Registry (configs → live instances) and the fan-in event bus every client folds. |
| API | `server/index.ts` | Bots, turns, approvals, model catalog, computer lifecycle, connectors, config — HTTP + SSE. |
| Voice | `server/tts/` | ElevenLabs, Fish Audio, Grok (xAI), built-in Mac voices, or local Chatterbox. Cloud keys stay on the harness; markdown is rewritten into something worth hearing before it is spoken. |
| App | `src/` | The chat shell. Server-backed store, one reducer, zero client-side transports. |
| Desktop | `electron/` | macOS, Windows, and Ubuntu shells with an embedded harness and platform capabilities; Apple speech stays macOS-only, Ubuntu GNOME Xorg and Wayland have opt-in local control, and other Wayland compositors stay unavailable. |

### Orchestrate Maximus over MCP

Maximus ships a stdio MCP server for external clients such as Claude Desktop and Cursor. It exposes a
deliberately bounded team control plane: inspect bots and channels, read/search compact transcript pages,
create and configure bots/channels/tasks, send work, wait for completion, switch models, and interrupt turns.
It does **not** expose approval grants, deletion, arbitrary settings, credentials, or computer lifecycle.

See [MCP server setup and tool reference](docs/mcp-server.md).

### Run it from scripts and CI

The `maximus` command drives a running workspace without a screen: set a
team up from a file, give a bot one job, wait until it and every teammate it
asked are done, and export what they made. One JSON document with `--json`,
and exit codes a script can branch on.

```sh
maximus team apply team.yaml
maximus run "Room Lead" "Rehearse the launch of https://example.com" --export ./out
```

See [Run Maximus from scripts and CI](docs/headless-cli.md).

## Documentation

The technical manual lives under [`docs/`](docs/README.md):

| | |
|---|---|
| [Documentation hub](docs/README.md) | Index of every guide |
| [Architecture](docs/architecture.md) | Harness, clients, Coolify stack, auth scopes |
| [Coolify / meetnote deploy](deploy/coolify/README.md) | Full product on one VPS · `pnpm deploy:vps` |
| [Self-hosting](docs/self-hosting.md) · [VPS guide](docs/deploy-vps.md) | Pair, tunnel, Tailscale, Docker+Caddy |
| [Verification](docs/verification/README.md) | Isolated fixtures before claiming a fix |
| [Mobile](mobile/README.md) | Flutter companion |
| [Releasing](docs/releasing.md) | Desktop installers |

## Quick start

**Hosted:** open [app.meetnote.cc](https://app.meetnote.cc). Desktop and phone
installers (when published) are linked from
[welcome → download](https://app.meetnote.cc/welcome#download). There is no
public GitHub Releases page for this product line.

Platform notes for local desktop builds: [macOS](docs/mac-desktop.md),
[Windows](docs/windows-desktop.md), [Ubuntu](docs/linux-desktop.md). A desktop
build can also pair as a client to another host over Tailscale; see
[desktop-to-desktop companion mode](docs/desktop-companion.md).

**From this repo (source):**

```sh
pnpm install

pnpm dev:server    # harness server → 127.0.0.1:8799
pnpm dev           # app → http://127.0.0.1:5199
pnpm dev:desktop   # Electron shell; keep the two commands above running
```

Deploy the Coolify VPS stack from a laptop: `pnpm deploy:vps`
([Coolify README](deploy/coolify/README.md)).

Requirements: **macOS, Windows, or Ubuntu 24.04 x64**, **Node 24+**, **pnpm**, and at least one agent CLI — [`claude`](https://claude.com/claude-code),
[`codex`](https://github.com/openai/codex), or [`grok`](https://x.ai/cli) — installed and logged in. They appear
in the model picker automatically.

Package the desktop application:

```sh
pnpm package:mac      # macOS: DMG + ZIP; requires Swift/Xcode tools
pnpm package:win      # Windows: installer + ZIP
pnpm package:linux    # Ubuntu x64: .deb + AppImage + verified CUA runtime
```

### Desktop capability status

| Capability | macOS | Windows x64 | Ubuntu 24.04 Xorg | Ubuntu 24.04 Wayland |
|---|---|---|---|---|
| Packaged app, embedded harness, local agent CLIs | Supported | Supported | Beta | Beta |
| Composio and Boat/cloud computers | Supported | Supported | Beta | Beta |
| Explicit preview-only local screen capture | Supported | Supported | Beta | Beta |
| Bot control of this computer | Supported, explicit opt-in | Not offered | Beta, explicit opt-in | Beta, GNOME only, explicit opt-in |
| Native on-device dictation | Supported | Not offered, Fish Audio instead | Planned | Planned |
| Dictation and Take turns calls through Fish Audio (needs a Fish Audio key) | Not used, on-device instead | Supported | Supported | Supported |

The Linux preview is user-initiated and never enables local bot control or Auto routing. The reviewed Cua
Driver 0.19.3 runtime starts only after explicit opt-in and without its full-screen cursor overlay. On GNOME
Wayland it also requires a passing Cua health report. Chat, preview, Cloud, and Local VM remain available on
both sessions. See the [Ubuntu Desktop guide](docs/linux-desktop.md).

The Linux packager downloads only the tag-pinned upstream archive during the build, verifies its size, SHA-256,
complete member allowlist, and inner executable hashes, then packages only the CLI and cursor-theme sidecar. The
installed app never downloads or self-updates native automation code. Cua's MIT notice, Inter's SIL OFL, a generated
third-party license report, and a CycloneDX inventory ship with the runtime. See
[`third_party/cua-driver/`](third_party/cua-driver/) for the reviewed provenance record.

These credentials are optional — local chat works without them. Paste a key once in **App Settings** (gear
in the sidebar footer) when you want to enable its integration:

| Credential | What it enables | Where to get it |
|---|---|---|
| Composio project key (`ak_…`) | Connect Gmail, GitHub, Slack, Notion, and other apps to your bots | [Maximus Composio setup](docs/composio.md) |
| Boat API key | Give bots an isolated remote Linux computer with a desktop and terminal | [Boat API key guide](https://docs.boat.dev/api-keys) |
| ElevenLabs key | Read replies aloud, and call your bots | [ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys) |
| Fish Audio key | Read replies aloud with Fish Audio voices, and call your bots | [Fish Audio API keys](https://fish.audio/app/api-keys/) |

Composio and Boat are third-party services with their own accounts and terms. Boat is a paid service after
its trial, and using a cloud computer may incur charges.

```sh
pnpm typecheck     # app + server
pnpm test          # unit, driver, API, and desktop capability tests
pnpm build         # typecheck + production build
pnpm check:electron # syntax-check Electron main/preload files
pnpm package:win   # Windows installer + zip → release/
pnpm package:linux # Ubuntu x64 .deb + AppImage → release/
```

### Triggers: schedules and webhooks

A trigger is "when something happens, a bot does something". Tell a bot "every weekday at 9, send me a summary
of my inbox" or "whenever our form calls, draft a reply" and it sets the trigger up in that turn with
its `trigger` tool (no confirmation; the chat shows a live card with Edit, Pause and Undo). **Triggers**, first in
the sidebar, lists every schedule and webhook, with a calendar and the run history. Bots manage them with
`trigger_info` (list, app events), `trigger` (create, update, pause, resume, run now) and `delete_trigger`; a webhook a bot makes never shows the bot its secret:
the person copies the link from the card or the Triggers page.

Schedules (routines) can run once, on selected weekdays, or every 5–1,440 minutes, using either a bot's configured
model/computer or the Cloud VM runner. Interval schedules stay aligned to their chosen start time and skip
an occurrence when the previous run is still active, so slow work cannot build an unbounded queue. A
separate optional Advanced run limit can safely stop stuck work; no timeout is imposed unless one is chosen.
The existing duration field remains calendar/display metadata. Webhook triggers are independent from schedules
but reuse the same queued task executor and calendar
receipts.

**App events** start a bot when something happens in a connected app ("whenever I get an email from Acme, draft
a reply"). The bot finds the app's events with `trigger_info` (`action: "events"`) and calls `trigger` with
`action: "create"` and `when: "app_event"`; the person can also choose **New → Set it up yourself → When something happens in an app**.
Composio sends each event to Maximus's connected-apps service, which queues it; the app collects the queue
with a long poll, so a desktop needs no public address and events wait while it is closed. Gmail is checked every
15 minutes; Slack, GitHub and other push apps arrive at once. A desktop keeps up to 500 events a day and a paid
Cloud 2,000; what is skipped shows on the automation. App events need the included connected apps: a server
using its own Composio key cannot watch apps yet. Details: [docs/composio.md](docs/composio.md#app-events).

Maximus starts a webhook-only receiver on `127.0.0.1:8800` by default (or one port above `MAXIMUS_PORT`).
Set `MAXIMUS_WEBHOOK_PORT` to choose another port. A webhook secret is shown once when the trigger is created
or rotated. Bearer authentication is recommended so the secret stays out of request URLs and most access
logs; a single capability URL remains available for senders that cannot configure headers. The receiver
exposes only `/health` and secret `/hooks/...` endpoints; it never exposes the app's broader API.
Maximus must remain running to accept a delivery. For public internet delivery, proxy only this
dedicated receiver through a hosted relay or a tool such as Tailscale Funnel.

## Status

Early but real — the loop works end to end: message → agent → streamed reply → tools → approvals →
computer use. macOS, Windows, and Ubuntu 24.04 x64 have released builds; Ubuntu remains a beta with the
capability limits above. A hosted full-product stack (accounts + chat + billing) runs at
[app.meetnote.cc](https://app.meetnote.cc); the Flutter app pairs to that origin by default. Webhook
triggers still use the local receiver rather than an always-on hosted relay.
Hosted voice needs an ElevenLabs, Fish Audio, or xAI key; built-in Mac and local Chatterbox voices need no cloud key. Take-turns calls and the composer mic listen on-device on macOS and through Fish Audio speech-to-text on Windows and Linux (the same Fish Audio key as voices). See [`docs/voice-mode.md`](docs/voice-mode.md) for the design and the known gaps.

Contributions welcome — the driver SPI in [`server/contracts.ts`](server/contracts.ts) is deliberately
small; adding a provider is one file in [`server/drivers/`](server/drivers/) plus a one-line registration.
No code needed at all for your own engines: any ACP-speaking CLI or OpenAI-compatible endpoint
plugs in through config — see [`docs/custom-engines.md`](docs/custom-engines.md).
Users can add their own MCP tool servers with zero code via [`docs/custom-mcp-servers.md`](docs/custom-mcp-servers.md).
To run bots on OpenRouter, Fireworks AI, DeepSeek, Cline or your own OpenAI- or Anthropic-compatible provider,
see [Other model providers](apps/docs/content/docs/providers/model-providers.mdx).

## Privacy

Usage analytics are optional and anonymous: product events and a once-a-day count of what is set up, never keys,
names, addresses or conversations. Turn them off in Settings → General → Usage analytics;
[`docs/analytics.md`](docs/analytics.md) lists every event and property.

## Run from a terminal or on a server

From this repo with Node 24+ and pnpm:

```sh
pnpm maximus
# or: node --experimental-strip-types server/maximus.ts
```

First launch guides you with arrow-key choices: choose AI access, sign in or paste
a hidden API key, choose a model, and optionally connect a phone. Next time, the
same command reuses your saved setup and opens Maximus on this computer. Keep the
terminal open; Ctrl-C stops the server, not your saved work. Use `--no-open` to
skip opening the browser.

Phone access is optional and defaults to skipping. Choose an explicitly
approved managed public HTTPS endpoint protected by pairing, an existing
Tailscale connection, or your own HTTPS reverse proxy. Both native apps pair from
this flow: the QR is an app link when you are connecting an Android phone, and the
iOS app takes either that or the web link. A browser works on either phone. A phone
cannot use a localhost link. `--local` ignores saved remote access for one launch;
`--no-pair` suppresses phone prompts and invitations but does not disable a saved
remote connection.

The web UI can also be installed from Safari or Chrome as a standalone phone
app. See [Install the phone web app](docs/phone-web-app.md) for Home Screen
installation and pairing.

Run `maximus setup` to reconfigure without resetting bots or conversations;
the saved model default applies only to new bots. Native setup confirms provider
sign-in; API setup asks before a potentially billable test message. API keys are
saved as plaintext, not encrypted, in private `config.json` (`0600` on Unix).
See the [short setup guide](docs/cli-onboarding.md) for account differences,
phone choices, credential storage, and cancellation.

For a background service on a VPS or an always-on computer, use
`pnpm maximus serve` (or the Coolify stack: [deploy/coolify/README.md](deploy/coolify/README.md))
with remote options such as `--tunnel` after login, `--tailscale`, or your own
domain. These are separate from AI-provider sign-in. Devices pair once with a
short code. Guides: [docs/deploy-vps.md](docs/deploy-vps.md),
[docs/self-hosting.md](docs/self-hosting.md).

## License

[Apache License 2.0](LICENSE) © 2026 Akingbade Kayode and Maximus contributors,
except `maximus-enterprise/`, which is source-available under its
[own license](maximus-enterprise/LICENSE); delete that folder and what remains is the
open-source edition. Details, including how contributions are signed off, are
in [LICENSING.md](LICENSING.md).

Packaged Cua Driver components retain their upstream MIT, SIL OFL 1.1, MPL-2.0, and other dependency terms;
the corresponding notices, license texts, source locations, and SBOM are in
[`third_party/cua-driver/`](third_party/cua-driver/) and ship beside the native runtime.

Maximus is an independent, open-source project inspired by Grok Bot. It is
not affiliated with, endorsed by, or associated with xAI; "Grok" is a trademark
of its respective owner.
