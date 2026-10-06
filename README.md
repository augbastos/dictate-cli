# DictateCLI

> Speak to Claude Code instead of typing.

DictateCLI adds a microphone button to Claude Code, using Claude Code's own native
voice dictation.

![DictateCLI: click the mic, speak, click Send, and Claude gets the prompt](docs/demo.svg)

**Click. Speak. Send.**

Windows 10/11 · Claude native voice · No extra API key · MIT

## Install

```powershell
git clone https://github.com/augbastos/dictate-cli
cd dictate-cli
pwsh -File scripts\install.ps1
```

Restart Claude Code. The microphone appears above the prompt.

Windows 10/11 x64. Requires Claude Code voice dictation, a microphone and
[PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows).

## Use

| Action | What it does |
|---|---|
| Click 🎙 | Start dictating |
| **Send** | Transcribe and send |
| **Cancel** / Esc | Discard the recording |
| Alt+D | Start / send from the keyboard |

Anything you were typing before dictation stays safe and comes back afterward.

## Why DictateCLI?

Claude Code already has voice dictation. DictateCLI does not replace it; it gives it
a simple microphone button.

- No extra speech service
- No extra API key
- No audio stored by DictateCLI
- No background process while idle

## Language

DictateCLI follows Claude Code's voice language setting. Change it in `/config` if
needed.

## Privacy

DictateCLI does not record or store audio and adds no telemetry.

Voice recording and transcription are handled by Claude Code's built-in voice
feature, through Anthropic.

## Compatibility

Current release: **Windows 10/11 x64**

Tested with Claude Code in the VS Code integrated terminal, in fullscreen mode.
DictateCLI runs inside Claude Code, so it is not tied to a specific editor.

macOS and Linux are not supported in this release. Details:
[docs/compatibility.md](docs/compatibility.md)

<details>
<summary><strong>Troubleshooting</strong></summary>

- **The mic button does not react.** Clicks need Claude Code's fullscreen mode. The
  installer turns it on; restart Claude Code.
- **Nothing is heard.** Allow the microphone in Windows Settings → Privacy & security
  → Microphone, and check that Claude Code's own `/voice` works.
- **Wrong language.** Set Claude Code's language in `/config`.
- **Alt+D does nothing.** Run the installer again, then restart Claude Code.
- **"Could not reach Claude Code voice."** Run the installer again.

</details>

## Uninstall

```powershell
pwsh -File scripts\uninstall.ps1
```

## How it works

DictateCLI is a small Claude Code plugin that adds the microphone button and
controls Claude Code's existing voice dictation. It has no speech engine of its own.
See [docs/architecture.md](docs/architecture.md).

## License

MIT
