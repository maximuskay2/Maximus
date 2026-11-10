# Windows Desktop

Maximus ships a Windows x64 desktop app as a per-user NSIS installer and a portable ZIP. The Electron
package embeds the harness server, so installed builds do not require Node, pnpm, or a terminal at
runtime. For the other desktop platforms, see [mac-desktop.md](mac-desktop.md) and
[linux-desktop.md](linux-desktop.md).

## What works

- The native Electron window and embedded Maximus server on Windows x64.
- Local Claude, Codex, Grok, Gemini, and other configured agent CLIs.
- Chat, streaming turns, approvals, bot-to-bot communication, and local data storage.
- Composio connected apps and Boat cloud computers.
- External documentation and OAuth links in the default browser.
- Explicit, view-only local screen preview.
- Dictation and Take turns calls through Fish Audio speech-to-text (needs a Fish Audio key).

Bot control of this computer is not offered on Windows. Use Chat, preview-only capture, Cloud, or
Local VM instead.

## Download packages

Choose one Windows x64 package from the latest release:

- [Installer (`Maximus-setup.exe`)](https://github.com/RELEASE_OWNER/Maximus/releases/latest/download/Maximus-setup.exe) — recommended; one-click, per-user, no admin rights.
- [Portable ZIP (`Maximus-<version>-x64.zip`)](https://github.com/RELEASE_OWNER/Maximus/releases/latest) — from the releases page; does not install system files.

Versioned packages and previous releases remain available on the
[releases page](https://github.com/RELEASE_OWNER/Maximus/releases).

## Build packages

Requirements for building from source:

- Windows x64
- Node.js 24 or newer
- pnpm 10.33.0 (Corepack can install the version declared by the project)

```powershell
git clone https://github.com/RELEASE_OWNER/Maximus.git
cd Maximus
corepack enable
pnpm install --frozen-lockfile
pnpm package:win
```

The build creates:

- `release\Maximus-<version>-setup.exe`
- `release\Maximus-<version>-x64.zip`

## Install and run

Run the downloaded `Maximus-setup.exe`: it installs per-user with one click and needs no admin rights.
The installer is not code-signed yet, so SmartScreen shows "Unknown publisher": choose **More info →
Run anyway**. To remove it, uninstall **Maximus** under Settings → Apps.

Application data remains local in `%USERPROFILE%\.maximus`. Electron window and browser data use the
normal per-platform application data directory (`%APPDATA%\maximus` unless the environment overrides
it).

Removing the app does not delete `%USERPROFILE%\.maximus`, so reinstalling keeps your bots and
transcripts.

### Upgrading from OpenMausBot

First launch copies `%USERPROFILE%\.openmausbot` to `%USERPROFILE%\.maximus` and verifies every file
landed; the old directory is left in place, so nothing is lost if you go back. Delete
`%USERPROFILE%\.openmausbot` yourself once you are happy with the new install.

### Updating

The app checks for updates in the background against `latest.yml` in the release feed and downloads
them by itself. Nothing restarts until you click **Restart to update**. A release missing `latest.yml`
leaves installed versions stranded, so every release ships it.

## Develop the desktop shell

Development mode uses three processes. Keep each command running in its own terminal:

```powershell
pnpm dev:server
pnpm dev
pnpm dev:desktop
```

## Agent CLI discovery

On Windows, Maximus uses the `PATH` of its own environment as-is. If a CLI still is not detected,
set an explicit additional path before launching the app from a terminal and verify it there:

```powershell
$env:MAXIMUS_EXTRA_PATH = "C:\your\custom\bin"
```

Restart Maximus after installing or signing in to a CLI.

## Dictation and voice

On-device dictation is macOS-only. On Windows, the composer mic and Take turns calls use Fish Audio
speech-to-text with the same Fish Audio key as voices (App Settings → API keys).

## Validate a package change

```powershell
pnpm typecheck
pnpm test
pnpm check:electron
pnpm package:win
```

The release pipeline additionally runs the Windows-native checks (packaged-server smoke against the
installed resources, cloudflared hash verification, and the Defender/AppLocker check lane) before any
release is published.

## Troubleshooting

### An agent CLI is missing

Run the CLI directly in a terminal, finish its sign-in flow, then restart Maximus. If it lives outside
`PATH`, use `MAXIMUS_EXTRA_PATH` while testing and report the install location so it can be considered
for automatic discovery.

### A bot needs computer tools

Choose **Cloud** (Boat) and add a Boat token in App Settings, or use Local VM. Bot control of this
computer is not offered on Windows.

### SmartScreen blocks the installer

The installer is not code-signed yet. On the "Unknown publisher" prompt, choose **More info → Run
anyway**. If the browser blocked the download itself, right-click the file → Properties → Unblock,
then run it again.

### The app does not start after an update

Reinstall from the latest `Maximus-setup.exe`; your data in `%USERPROFILE%\.maximus` is untouched by
reinstalling.
