# Grok-parity and competitive-upgrade roadmap

Who builds this is in [2026-11-10-team-execution-roadmap.md](2026-11-10-team-execution-roadmap.md). This file is the spec for the parity sprints. The team starts from the execution roadmap.

Date: 2026-11-10. Compared the written directive (cloud computer, multi-bot handoff, teach-by-demonstration, safety controls, hybrid execution, BYOK, BYOA, semantic cache, skill marketplace) with the code and the plans already in `docs/plans/`. The YouTube setup video is the same product shape this repo already documents: an always-on runner, a browser the person can take over, and app connections. This plan lists only the work still missing.

## Verdict

Five capabilities are already the product. Eight are present with a specific hole. Five are absent. Do not stand up a second browser, a second vault, a second webhook system, a Redis bus, or a LiteLLM proxy beside the code named below.

| Already shipping | Where |
| --- | --- |
| Headless browser with saved cookies and local storage | `server/browser-engine.ts`, `AGENT_BROWSER_RESTORE`, encrypted session key |
| Named bots, roles, system prompts, rooms | bots, groups, `server/group-goal-run.ts` |
| Ask / Auto / Custom approvals, tool and connector scopes | permission proxy, approval cards |
| Encrypted logins, TOTP, one-use `secret-ref`, DOM fill the model never sees | `server/login-store.ts`, `server/secret-vault.ts`, `server/login-fill.ts` |
| Host desktop control plus a container desktop plus a cloud computer | `server/local-computer.ts`, `server/container-computer.ts`, `server/boat.ts` |
| Five model providers, bring-your-own keys, bundled gateway, workspace wallet | drivers, `server/billing/gateway.ts`, `server/billing/ration.ts`, `server/spend.ts` |
| Inbound signed webhooks that start a bot or post into a room | `server/webhooks.ts` |
| Phone push for approvals, questions, sign-in, and secrets | `server/mobile-push.ts` (`NEEDS_YOU`) |
| Skill library, `/learn`, skill share, exact-match computer replay on macOS | `server/skill-learn.ts`, `server/saved-steps/` |
| Connector catalog (Gmail, Slack, GitHub, and the rest) | `server/composio.ts` |

## Gaps, in the directive's order

### 1. Cloud computer

The directive asks for a persistent microVM per bot, with its own browser, terminal, and workspace, that keeps running after the person closes the app.

What exists is three computers, chosen per bot:

- The host, driven by the Cua driver through `gatedLocalComputer`.
- A Docker or Podman XFCE container (`localhost/maximus/cua-local-vm`), shared or one container per bot (`perBotLocalVmTarget`).
- A Boat cloud sandbox. Background commands return immediately (`detached: true`) and the sandbox stays awake at most two hours (`BACKGROUND_KEEPS_AWAKE_MS`).

Browser logins already survive across runs, on the engine's profile, on the server that holds that profile. That profile is a login boundary. The browser plan says so: it is not an OS sandbox.

Still missing:

- A run record that survives a server restart. Thread follow-ups wait in memory (`docs/plans/2026-09-09-independent-threads.md`). Closing the phone is fine while the harness process stays up (Docker, a VPS, Cloud home). Sleeping the laptop, or restarting the process, drops the queue.
- A billed "keep this computer awake" policy past the two-hour Boat cap, tied to the workspace wallet.
- A kernel-level microVM. The container and the Boat sandbox are the isolation we ship. A Firecracker-class VM is a new runtime, and it earns its place only if a customer requires a kernel boundary the container does not give. Until that requirement is real, extend the container and Boat paths.

### 2. Multi-bot collaboration

Bots already have names, instructions, and membership in rooms. A group goal wakes members in turn, waits while one is busy, and stops with the room. Memory, threads, browser profiles, and secret refs are partitioned by bot. A shared computer and team files are an explicit choice.

Still missing:

- A structured handoff. Today Bot A talks to Bot B by writing into the room and the coordinator deciding the next member. There is no envelope a bot can address to another bot with a payload and a task id, and there is no Redis in the server. The harness stays the bus. Add the envelope on the room runtime.
- A default file root and computer that belong to that bot alone. Sharing stays opt-in, which the product already allows, and the default for a new bot becomes its own root.

### 3. Teach-by-demonstration

`/learn` asks the model to write a `SKILL.md` from the conversation. Saved steps journal host-computer tool calls and replay them only when the later request uses the same words, only on macOS, and only for a direct chat turn. A failed step hands the turn back to the model. Browser tools, the local VM, rooms, routines, and peer asks are outside that recorder. There is no browser extension, no DOM click log, and no parameterised skill another bot on the account can run.

That recorder is the largest net-new build in this plan.

### 4. Human approval and the vault

Approvals already stop a tool call and push the phone. The live browser already hands the screen to the person for a sign-in. Saved logins already fill the page through `fillLogin` while the model holds a reference.

Still missing:

- A detector. The agent does not yet pause itself because the page is a CAPTCHA, a 2FA challenge, a checkout, or a mail-send form. The person pauses it, or a tool policy asks.
- A small allow-list of those page classes, wired to the approval card that already exists. New policy rows, same card.

### 5. Hybrid desktop and cloud

The desktop app, the headless server, the phone, the host Cua driver (macOS, Windows, Linux), the local VM, and the Boat computer already cover "run here or run in the cloud." Local environments isolate a whole data directory on one install.

Still missing:

- One control that says where the next turn's computer is, without the person picking a driver.
- A headless daemon that is the server, installable without the Electron window. `docs/plans/remote-workspace.md` already separates launch from access. The remaining slice is packaging that daemon on macOS, Windows, and Linux and pointing the installed app at it.

### 6. Model gateway and bring-your-own key

Claude, ChatGPT/Codex, Grok, Kimi, and Muse are selectable. Bring-your-own traffic uses the person's key and is not debited. Bundled traffic attaches our key only inside `server/billing/gateway.ts`. OpenAI-compatible endpoints, including Ollama, already exist as drivers. A helper model can be turned off per bot. Spend is a workspace wallet and a monthly cap (`server/spend.ts`), plus hour and day caps on bring-your-own.

Still missing:

- A router that sends a short tool-formatting step to a cheap model and a reasoning step to a large one, on the gateway we have.
- A budget counted on the bot, drawn from the workspace wallet, so one bot cannot empty the ration.
- DeepSeek as a named provider if the roster grows. The design note is `docs/superpowers/specs/2026-10-22-deepseek-harness-engine-design.md`. It follows the same driver pattern. It is not a new gateway.

### 7. Bring your own agent

`server/webhooks.ts` already accepts a signed POST, dedupes the delivery, and either enqueues that bot or posts into its room. Billing webhooks are a different door and stay that way.

Still missing:

- A manifest for an external runner: name, URL, auth, input schema, which bots may call it.
- The harness calling that URL as a tool, with the same approval rules as any other side effect.
- Inbound webhooks stay the trigger. They do not need a second implementation.

### 8. Semantic cache

Nothing in the server embeds a request and returns a cached completion. Saved steps are exact words, and they skip the model only for a recorded computer recipe.

A cache is safe only for reads that the bot could repeat without changing the world: a page fetch, a code explanation, a lookup. A POST, a click, a send, and a payment never hit it. The cache key includes the bot's model and the tool arguments. A hit debits zero and writes a ledger row that says so, so the wallet and the margin report stay honest.

### 9. Skill marketplace and royalties

The connector marketplace sells nothing of ours. Skill share moves a skill between bots and teams. There is no creator account, no price, no purchase, and no royalty split.

This is a product and payments project on top of the skill library. It waits until a recorded skill is a real artifact someone else can run (section 3). Stripe and Paystack already collect workspace fees. A skill purchase is a new catalog, not a new processor.

## Build order

Four sprints. Each one extends a file that already exists. Each one is done only when the proof at the end passes on an isolated fixture (`docs/verification/README.md`).

### Sprint 1 — A run you can leave

1. Persist the per-bot wait queue and the in-flight turn id under the data directory. A restart resumes or marks the turn interrupted with the transcript intact. The in-memory queue in the independent-threads plan is the behavior to keep. The storage is the change.
2. Reconnect: the phone, the desktop, and the browser attach to that turn's existing SSE stream and see what already happened.
3. Awake policy on the Boat computer: the person (or a routine) can hold the sandbox for the run, the hold debits the workspace wallet, and the two-hour default remains the unpaid ceiling.
4. New bots default to their own container target and their own browser profile. Shared stays available in the computer setting.

Leave Firecracker off this sprint.

Proof: start a turn on an isolated harness, stop the client, restart the server, open the client, and read the same turn. A second bot's container name is `perBotLocalVmTarget`, and its browser profile id is its own.

### Sprint 2 — Handoff and page classes

1. Add a handoff message on the room path: from bot, to bot, task id, payload, and the thread it lands in. The receiving bot wakes on its own lane, as group goals already wait. Busy still means "finishing another conversation," then the handoff runs.
2. Page-class rules on the approval card: CAPTCHA, 2FA, checkout, and outbound email pause the browser tools and push `approval` (already in `NEEDS_YOU`). The person takes over on the live browser we have, then hands it back.
3. Default workspace directory per bot. A group workspace is a setting, shared on purpose.

Proof: Bot A hands a payload to Bot B in a fixture room. Bot B's transcript contains the payload and Bot A's memory file does not. A fixture page marked checkout opens an approval and does not submit.

### Sprint 3 — Router, external runners, per-bot ration

1. On `server/billing/gateway.ts`, classify a bundled call as format or reason. Format uses the cheap model pinned in the ration profile. Reason uses the bot's selected model. Bring-your-own calls skip the router and keep the person's key.
2. External runner manifest beside webhooks. A bot tool calls the URL. Approval treats it as a side effect. The inbound webhook still starts our bot.
3. Per-bot ceiling inside the workspace wallet. At the ceiling, that bot returns the existing `spend_cap` 409. Other bots in the workspace keep spending until the workspace cap.

Proof: a format call in the fixture hits the cheap model id and a reason call hits the selected id. A replayed webhook still runs once. Bot A's ceiling stops Bot A while Bot B still runs. A bring-your-own turn never carries the gateway key.

### Sprint 4 — Recorder, daemon, cache, catalog

1. Browser recorder on our browser tools (the same verbs the agent already calls). A finished recording becomes a skill with named parameters, reviewed through the skill-review flow, runnable by any bot on the account that is granted that skill. Pixels are not steps. Selectors and labels are. A step that would have needed approval still needs it on replay.
2. Package the headless server as the daemon on macOS, Windows, and Linux. The Electron app and the phone are clients.
3. Read-only semantic cache in front of model calls whose tool trace is entirely reads. Side effects bypass it. A hit writes a zero-debit ledger row.
4. Skill catalog: a creator publishes a reviewed skill, a workspace buys it, the ledger records the split. Ship this last, and only after the recorder produces a skill a stranger can run.

Proof: record a fixture login-free flow, run it as another bot with one parameter changed, and see a single model call for the authoring and none for the replay. A POST tool in the trace misses the cache. The daemon answers `/api/health` with the app window closed.

## Explicitly out of scope

- Replacing agent-browser with Playwright or Puppeteer.
- A Redis pub/sub path beside rooms.
- LiteLLM, or any proxy that holds provider keys outside `server/billing/gateway.ts`.
- A second secret store beside `login-store` and `secret-vault`.
- Caching clicks, sends, checkouts, or any tool that changes the target.
- Per-customer microVMs, until a written requirement says the container boundary is insufficient.
- Rebuilding billing, SSO, the phone, or the Railway control-plane move. Those plans stay the source of truth for their own work.

## What this changes in the current release plans

The takeover roadmap, the ration roadmap, and the Railway roadmap keep shipping v0.1.0. This document starts after that gate. Sprint 1's queue durability and Sprint 3's per-bot ceiling are the two items that touch billing and the harness core. They land as their own changes with their own fixture proofs, after the v0.1.0 abort rule has cleared.
