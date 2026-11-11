# Team execution roadmap

Date: 2026-11-10. This is the document Lanre, Wande, and Tosin follow. The other plans stay the specs. They are not four competing backlogs.

| Spec | What it decides |
| --- | --- |
| [2026-11-06-maximus-takeover-roadmap.md](2026-11-06-maximus-takeover-roadmap.md) | v0.1.0 release gate |
| [2026-11-06-maximus-contracts.md](2026-11-06-maximus-contracts.md) | Frozen names, entitlements, webhook schema |
| [2026-11-10-llm-ration-billing-roadmap.md](2026-11-10-llm-ration-billing-roadmap.md) | Wallet, Muse rates, plan prices |
| [2026-11-10-railway-control-plane-roadmap.md](2026-11-10-railway-control-plane-roadmap.md) | Accounts and the chat server on Railway |
| [2026-11-08-flutter-mobile-roadmap.md](2026-11-08-flutter-mobile-roadmap.md) | Phone client. Phases 0–10 are built. Store upload waits on owner certs |
| [2026-11-10-grok-parity-roadmap.md](2026-11-10-grok-parity-roadmap.md) | Work after v0.1.0. Read it for the proofs. The sprint order below is the assignment |

The product manager accepts or sends back. A developer does not reorder sprints, change a frozen contract, or edit another person's directories.

Individual instructions: [Lanre](2026-11-10-lanre.md), [Wande](2026-11-10-wande.md), [Tosin](2026-11-10-tosin.md).

## How the three stay apart

| Owner | Directories |
| --- | --- |
| Lanre | `electron/`, `src/`, `mobile/`, `build/`, desktop and mobile release workflows |
| Wande | `server/` except `server/billing/` and `server/routes/billing.ts`. Includes the gate, drivers, browser, computers, rooms, skills, and bot webhooks |
| Tosin | `server/billing/`, `server/routes/billing.ts`, `server/spend.ts`, `server/usage-ledger.ts`, `cloudflare/control-plane/`, the Railway accounts service, `deploy/` |

`server/index.ts` is Wande's file. Lanre and Tosin add a route module in their own directories and hand Wande the mount. Two open pull requests never edit the same file. The directory owner lands first. The other rebases.

Proofs run on an isolated fixture, as [docs/verification/README.md](../verification/README.md) requires. A green test against a live user directory is not acceptance.

## Release A — v0.1.0, starting now

Ship one tag. The parity sprints stay closed until the product manager marks this gate passed. Already-verified work stays put: the phone phases, the admin dashboard, the ration profile save, and the desktop sign-in picker are not rebuilt.

### Lanre — the apps people install

Close the installer gate from the takeover plan.

- macOS arm64 and x64: signed and notarized `.dmg`, the app launches, one agent turn completes, the update feed matches the build.
- Windows x64: the CI `package-win` lane produces the OV-signed installer. A local cross-compile is a check, not the release artifact.
- Linux x64: `.deb` and AppImage from CI on real x64, including the CUA hash check. Emulation is not the proof.
- `rg -li 'openmausbot|mausbot'` is clean in `electron/`, `src/`, and `mobile/` outside attribution and the migration shim.
- Phone: keep `flutter analyze` and `flutter test` green. Store listing stays in `mobile/STORE_RELEASE.md`. Uploading to TestFlight or Play waits on the owner's certificates. Lanre does not enroll those accounts.

Done when all three installers from one pipeline install, boot, and finish a turn, and the client trees pass the rebrand search.

### Wande — the harness the installers boot

Hold the agent runtime steady while Tosin moves accounts and billing.

- Five providers (Claude, Codex, Grok, Kimi, Muse) each honor the three switch levels in [the contracts](2026-11-06-maximus-contracts.md): operator kill-switch, workspace toggle, per-bot choice. An off provider is hidden with a reason.
- `server/enterprise.ts` matches the frozen gate: `entitled()`, `editionStatus()`, `createWorkspaceAccess()`, `hostedWorkspaceConfiguration()`. Unknown entitlement ids grant nothing.
- Bring-your-own traffic never receives the gateway key. Bundled traffic never receives the user's key.
- Mount route modules Lanre or Tosin hand over. Review those mounts. Do not take their features into the harness "while you are there."

Done when the provider matrix and the gate tests pass, and a packaged server from Lanre's installer completes one turn on each provider that the switchboard has turned on.

### Tosin — accounts and the wallet

The local accounts process is still Wrangler on port 8787. Production moves off that.

- Follow the Railway plan in order: Postgres and a Node accounts process, then auth and mail, then workspaces through billing, then delete the Cloudflare tunnel path, then the Railway project, then point desktop and phone at the new accounts URL.
- Prove the ration on an isolated workspace, from the ration plan's proof list: the free grant equals the saved amount, one bundled turn debits the formula, a bring-your-own turn does not debit and does not see the pool key, a replayed invoice does not grant the month twice, a turn at zero returns `spend_cap`.
- Stripe and Paystack stay on the harness billing routes. Price ids stay in `MAXIMUS_STRIPE_PRICES` and `MAXIMUS_PAYSTACK_PLANS`. Recheck Muse list prices before any catalog save. Included provider cost stays at or under half the seat price.

Done when an isolated Postgres runs the control-plane tests with no D1 and no `cloudflare:test`, a sign-in code arrives by SMTP, the chat image answers `/api/health` on its public URL, and the ration proof holds. Desktop signing and store products are Lanre's and the owner's, not Tosin's.

### Product manager — the gate

Accept Release A only when Lanre's installer proof, Wande's provider proof, and Tosin's Railway and ration proofs are all green on the same tag. One missing proof holds the tag. Contract changes come back to the product manager before either owner edits [the contracts file](2026-11-06-maximus-contracts.md).

## Release B — parity, after the tag

The behavior and the proofs are in the [parity roadmap](2026-11-10-grok-parity-roadmap.md). The split below is who writes them. Firecracker, Redis, LiteLLM, a second browser, and a second vault stay out.

### Sprint 1 — a run you can leave

- **Wande:** persist the per-bot wait queue and the in-flight turn id. A restart resumes the turn or marks it interrupted with the transcript intact. New bots default to `perBotLocalVmTarget` and their own browser profile.
- **Lanre:** desktop, phone, and browser reattach to that turn's SSE stream and show what already happened.
- **Tosin:** an awake hold on the Boat computer past two hours debits the workspace wallet. The unpaid ceiling stays two hours. Expose the debit. Wande calls it. Tosin does not edit the computer lifecycle.

Done when the sprint 1 proof in the parity plan passes, and the debit shows on the wallet.

### Sprint 2 — handoff and page classes

- **Wande:** room handoff with from-bot, to-bot, task id, and payload. CAPTCHA, 2FA, checkout, and outbound email pause browser tools and push `approval`. A new bot's file root is its own. A group workspace is an explicit setting.
- **Lanre:** the phone and desktop render that same approval card, including a checkout pause.
- **Tosin:** no feature work. Review only if the push payload gains a field. The existing `approval` kind stays.

Done when Bot A's memory file lacks Bot B's payload, and a fixture checkout opens an approval and does not submit.

### Sprint 3 — router, external runners, per-bot ration

Land Tosin's ceiling before Wande's router. Both touch the gateway. One pull request at a time.

- **Tosin:** a per-bot ceiling inside the workspace wallet. At the ceiling, that bot gets the existing `spend_cap` 409. Other bots in the workspace keep spending until the workspace cap.
- **Wande:** after that pull request merges, classify a bundled call as format or reason. Format uses the cheap model pinned in the ration profile. Reason uses the bot's selected model. Bring-your-own calls skip the router. Add the external runner manifest beside `server/webhooks.ts`. Calling that URL is a side effect and uses the approval card. The inbound webhook still starts our bot.
- **Lanre:** no server work. Settings may show the per-bot ceiling once Tosin's API is frozen. The product manager names that screen before Lanre designs it.

Done when the sprint 3 proof passes: cheap model on a format call, selected model on a reason call, one webhook delivery runs once, Bot A stops at its ceiling while Bot B still runs.

### Sprint 4 — recorder, daemon, cache, catalog

- **Wande:** browser recorder on the existing browser verbs. Selectors and labels, never pixels. A finished recording becomes a reviewed skill with named parameters. A step that needed approval still needs it on replay. Read-only semantic cache in front of model calls whose tool trace is entirely reads. A POST, a click, a send, or a payment never hits the cache. A hit writes a zero-debit ledger row through Tosin's ledger API.
- **Lanre:** package the headless server as the daemon on macOS, Windows, and Linux. The Electron app and the phone are clients. The recorder's review screen uses the skill-review flow Wande already has.
- **Tosin:** skill purchase catalog last, and only after a stranger can run Wande's recorded skill. Stripe and Paystack stay the processors. A purchase writes a royalty split on the ledger.

Done when the sprint 4 proof passes: one model call to author, none to replay with a changed parameter, a POST misses the cache, and the daemon answers `/api/health` with the app window closed.

## What each person reports

A report names the proof, the command, and the result. "Working on the gateway" is not a report. A blocked proof names the file and the owner whose directory it sits in. The product manager reassigns only by editing this document.
