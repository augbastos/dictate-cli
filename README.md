# DictateCLI

![CI](https://github.com/augbastos/dictate-cli/actions/workflows/ci.yml/badge.svg)
![Licence: MIT](https://img.shields.io/github/license/augbastos/dictate-cli)
![Latest tag](https://img.shields.io/github/v/tag/augbastos/dictate-cli)

> Speak to Claude Code instead of typing.

DictateCLI adds a microphone button to Claude Code, using Claude Code's own native
voice dictation. Click, speak, send.

![DictateCLI: click the mic, speak, click Send, and Claude gets the prompt](docs/demo.gif)
<sub>Simulated animation of the flow, not a screen recording.</sub>

## What it does

- Adds a microphone button above the prompt. It drives Claude Code's built-in voice dictation.
- Anything you were typing before dictation is set aside and put back afterward, if the
  prompt is empty by then.
- No extra speech service, no extra API key, no audio stored by DictateCLI, no background
  process while idle.
- Follows Claude Code's voice language setting. Change it in `/config` if needed.

It is a small Claude Code plugin with a helper program built on your machine. It has no
speech engine of its own. See [docs/architecture.md](docs/architecture.md).

## Requirements

- Windows. macOS and Linux are not supported in this release.
- Claude Code 2.1.287 or newer, with voice dictation, and a microphone.
- [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows).

The installer checks these first and changes nothing if one is missing.
`pwsh -File scripts\doctor.ps1` tells you if anything is off.

## Install

The installer enables Claude Code's fullscreen mode so the microphone button can
receive clicks. [Uninstall](#uninstall) restores your previous renderer setting.

```powershell
git clone https://github.com/augbastos/dictate-cli
cd dictate-cli
pwsh -File scripts\install.ps1
```

Restart Claude Code. The microphone appears above the prompt.

Installed the plugin another way, for example with `/plugin`? Run `/dictate setup` once
instead, then restart Claude Code; run it again after each plugin update.
`/dictate remove` undoes it.

## Use

| Action | What it does |
|---|---|
| Click the mic button | Start dictating |
| **Send** | Transcribe and send |
| **Cancel** / Esc | Discard the recording |
| Alt+D | Start / send from the keyboard |

## Configuration

- **Shortcut.** The installer takes `-Shortcut alt+d` (default) or `-Shortcut disabled`.
  Other chords can be bound to `command:dictate` in `~/.claude/keybindings.json`
  (context `Chat`). Function keys are refused.
- **Installer switches.** `-Beside` shares the row above the prompt with another plugin's
  card. `-NoFullscreen` leaves the renderer alone (the button is then not clickable;
  `/dictate` still works).
- **Plugin options.** `icon` is `nerd` (default, needs a Nerd Font) or `emoji`. `beside`
  is the same as `-Beside`.
- **Settings page.** `/dictate settings` opens a panel that shows the current shortcut and voice language and where to change each.

## What it runs and sends

- **Programs.** The plugin itself starts two:
  - Its own helper, `bin\dictate-key.exe` (built from `helper/dictate-key.cs` on your
    machine), with one of three fixed words and no text of yours. `f11` and `escape`
    press that key in Claude Code's own console, to start, stop or cancel Claude Code's
    voice dictation. `mic` looks up the process that started it (Claude Code) and reads
    Windows' record of that app's microphone use. It runs only while you dictate.
  - PowerShell 7 (`%ProgramFiles%\PowerShell\7\pwsh.exe`), only when you type
    `/dictate setup` or `/dictate remove`, to run the bundled install or uninstall
    script. Setup reads `settings.json` and `keybindings.json` in your Claude Code
    folder, copies them to its `backups` folder, edits them, and runs `claude --version`
    and the C# compiler that ships with Windows (`csc.exe`) to build the helper. Remove
    puts the earlier values back. [SECURITY.md](SECURITY.md) lists the changes.
- **What it reads.** The prompt box while you dictate (your unsent draft, then the live
  transcript), `~/.claude/keybindings.json` to show your shortcut, and Claude Code's
  settings, from which it uses one field, the voice `language`. It also reads environment
  variables that hold folder paths (`ProgramFiles`, `USERPROFILE`, `HOME`; the setup
  script also `CLAUDE_CONFIG_DIR` and `WINDIR`). Your draft is kept in memory only, never
  written to disk. It does not read your conversation history, and it never uses or sends a
  password, token or API key. It declares no MCP server.
- **What it sends.** Only a prompt, through Claude Code's own prompt-submit call: the
  text goes where your prompts go, and DictateCLI contacts no server itself. The text is
  what is in the prompt box when the dictation ends: Claude Code's transcript, plus
  anything you typed into the box meanwhile. Claude Code sends longer transcripts itself
  and DictateCLI lets that send through unchanged; it submits the short ones. Your unsent
  draft is set aside first and is not in what DictateCLI submits. It is put back afterward
  if the prompt box is empty by then.
- **Hooks.** `session.start` registers the `/dictate` command and reads your shortcut.
  `command.run` is handled for `/dictate` only (start or send a dictation;
  `/dictate settings`, `/dictate setup`, `/dictate remove`), and DictateCLI does not
  intercept or run any other slash command. `prompt.submit` and `prompt.edit` act only
  while a dictation is running: the send goes through unchanged, and if you type while
  Claude Code transcribes, DictateCLI stops its own automatic send and puts your draft
  back in front of what you typed. `ui.render` draws the microphone button and the
  settings panel, and reads whether a turn is running and whether a survey is showing.
  More in [docs/architecture.md](docs/architecture.md).
- **Network.** None of its own.

## Privacy

DictateCLI itself records no audio, stores no audio or transcripts, opens no network
connection and adds no telemetry. Your voice is captured and transcribed by Claude Code's
built-in voice dictation, which sends the audio to Anthropic. Details:
[PRIVACY.md](PRIVACY.md).

## Compatibility

Tested on Windows, with Claude Code in the VS Code integrated terminal. Other terminals,
such as Windows Terminal, are not yet tested. macOS and Linux are not supported in this
release. Details: [docs/compatibility.md](docs/compatibility.md)

<details>
<summary><strong>Troubleshooting</strong></summary>

- **The mic button does not react.** Clicks need Claude Code's fullscreen mode. The
  installer turns it on; restart Claude Code.
- **Nothing is heard.** Allow the microphone in Windows Settings → Privacy & security
  → Microphone, and check that Claude Code's own `/voice` works.
- **Wrong language.** Set Claude Code's language in `/config`.
- **Alt+D does nothing.** Run the installer again, then restart Claude Code.
- **"Could not reach Claude Code voice."** Run the installer again.
- **Anything else.** Run `pwsh -File scripts\doctor.ps1`; it names what is wrong and
  how to fix it.

</details>

## Uninstall

```powershell
pwsh -File scripts\uninstall.ps1
```

## Layout

| Path | What it is |
|---|---|
| `hooks/` | The plugin code (TypeScript) and its tests |
| `helper/` | The small Windows key helper, built locally into `bin/` |
| `scripts/` | Install, uninstall and doctor scripts |
| `tests/` | Installer tests (PowerShell) |
| `docs/` | Architecture, compatibility and the demo animation |
| `.claude-plugin/` | Plugin manifest and marketplace entry |

## Tests and CI

CI builds the helper, validates the plugin with `claude plugin validate .`, runs
`claude plugin test .`, and runs the installer tests in `tests/`. See
[.github/workflows/ci.yml](.github/workflows/ci.yml).
The offline workflow contract runs first; run it alone with
`pwsh -NoProfile -File tests/ci-workflow.ps1` (Git Bash and jq required).

CI installs a pinned Claude Code version from `.github/ci/package-lock.json`, using
the official Node setup action's npm cache. After validation, plugin tests and the
two installer test modules run in separate processes, on up to three CPU cores.
Run `pwsh -NoProfile -File tests/ci.ps1` on Windows to run the same tests with an
installed Claude Code. CI reports `Safety`, `Lint`, `Test (Windows)`, and `CI passed`.
The required checks are `Safety` and `CI passed`. `Safety` runs on pull requests
using the base revision's policy; `CI passed` requires every job to succeed,
allowing only `Safety` to be skipped outside pull requests.

## More

[Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md) ·
[Security](SECURITY.md) · [Terms](TERMS.md) · [Privacy](PRIVACY.md)

## License

MIT. DictateCLI is an independent community plugin, not made or endorsed by Anthropic.
