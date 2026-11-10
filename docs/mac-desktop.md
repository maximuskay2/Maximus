# macOS Desktop

Maximus ships a signed and notarized macOS desktop app for Apple silicon and Intel Macs. The Electron
package embeds the harness server, so installed builds do not require Node, pnpm, or a terminal at
runtime. For the other desktop platforms, see [windows-desktop.md](windows-desktop.md) and
[linux-desktop.md](linux-desktop.md).

## What works

- The native Electron window and embedded Maximus server on Apple silicon and Intel.
- Local Claude, Codex, Grok, Gemini, and other configured agent CLIs.
- Chat, streaming turns, approvals, bot-to-bot communication, and local data storage.
- Composio connected apps and Boat cloud computers.
- External documentation and OAuth links in the default browser.
- Explicit, view-only local screen preview.
- Explicit opt-in local computer control using the bundled Cua runtime.
- On-device dictation and voice calls with no API key, through the bundled speech helper.

The local preview does **not** give the bot control of this computer by itself. Local control requires
allowing control when asked, granting Accessibility and Screen Recording in System Settings, and
assigning a bot to **This computer**; every action still enters the approval flow.

## Download packages

Choose one macOS package from the latest release:

- [Apple silicon DMG (`Maximus.dmg`)](https://github.com/RELEASE_OWNER/Maximus/releases/latest/download/Maximus.dmg) — recommended for M1 and later.
- [Intel DMG (`Maximus-intel.dmg`)](https://github.com/RELEASE_OWNER/Maximus/releases/latest/download/Maximus-intel.dmg) — for Intel Macs.

Versioned packages and previous releases remain available on the
[releases page](https://github.com/RELEASE_OWNER/Maximus/releases).

## Build packages

Requirements for building from source:

- macOS with Xcode command-line tools (Swift is needed for the speech helper)
- Node.js 24 or newer
- pnpm 10.33.0 (Corepack can install the version declared by the project)

```sh
git clone https://github.com/RELEASE_OWNER/Maximus.git
cd Maximus
corepack enable
pnpm install --frozen-lockfile
pnpm package:mac
```

The build creates:

- `release/Maximus-<version>-arm64.dmg`
- `release/Maximus-<version>-x64.dmg`
- `release/Maximus-<version>-arm64.zip`
- `release/Maximus-<version>-x64.zip`

Signing and notarization run after the build; see [releasing.md](releasing.md).

## Install and run

Open the downloaded `.dmg`, drag **Maximus** to Applications, and open it. To remove it, delete
`/Applications/Maximus.app`. Application data remains local in `~/.maximus`; Electron window and
browser data use the normal per-platform application data directory
(`~/Library/Application Support/maximus` unless the environment overrides it).

Removing the app does not delete `~/.maximus`, so reinstalling keeps your bots and transcripts.

### Upgrading from OpenMausBot

First launch copies `~/.openmausbot` to `~/.maximus` and verifies every file landed; the old
directory is left in place, so nothing is lost if you go back. Delete `~/.openmausbot` yourself once
you are happy with the new install.

### Updating

The app checks for updates in the background against `latest-mac.yml` in the release feed and downloads
them by itself. Nothing restarts until you click **Restart to update**.

### Permissions

macOS asks for each capability the first time a bot needs it, in the system's own prompts:

- **Microphone** and **Speech Recognition** for dictation and voice calls.
- **Accessibility** when you let a bot control this Mac.
- **Screen Recording** so bots can see this Mac before acting.

If a permission was denied, grant it under System Settings → Privacy & Security, then restart Maximus.

## Develop the desktop shell

Development mode uses three processes. Keep each command running in its own terminal:

```sh
pnpm dev:server
pnpm dev
pnpm dev:desktop
```

## Agent CLI discovery

A Mac app opened from the Dock or Finder gets launchd's bare `PATH`, not the person's shell `PATH`.
Maximus reads the login shell `PATH` once in the background and adds the usual install folders
(`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`) when they exist. If a CLI still is not
detected, set an explicit additional path before launching the app from a terminal and verify it there:

```sh
MAXIMUS_EXTRA_PATH=/your/custom/bin open -a Maximus
```

Restart Maximus after installing or signing in to a CLI.

## Enable local control

Installed builds include the Cua runtime for macOS. Assign a bot to **This computer**, choose **Allow
control of this computer** when asked, then grant Accessibility and Screen Recording in System Settings
and relaunch the app. No driver download, terminal command, or daemon setup is required. If control
reports it is not ready, check Driver detail, fix what it names, and click **Retry**.

## Dictation and voice

The signed `Maximus Speech.app` helper ships inside the app bundle and transcribes on-device: the
composer mic and Take turns calls need no API key on macOS. If dictation reports it is off, turn on
Dictation in System Settings → Keyboard, then try again.

## Troubleshooting

### An agent CLI is missing

Run the CLI directly in a terminal, finish its sign-in flow, then restart Maximus. If it lives outside
the common directories above, use `MAXIMUS_EXTRA_PATH` while testing and report the install location
so it can be considered for automatic discovery.

### A bot needs computer tools

Choose **Cloud** (Boat) and add a Boat token in App Settings, use Local VM, or enable local control
and assign the bot to **This computer**.

### Gatekeeper refuses to open the app

Release builds are signed and notarized, so this should not happen with a download from the releases
page. Re-download the `.dmg` from the releases page if it happens; Gatekeeper verifies the signature
automatically when the app opens.

### Dictation or voice does not start

Confirm Microphone and Speech Recognition permission under System Settings → Privacy & Security, and
that Dictation is on under System Settings → Keyboard. Restart Maximus after changing either.
