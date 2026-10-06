# DictateCLI

> Speak to Claude Code instead of typing.

Claude Code can already take dictation. DictateCLI puts it behind a simple microphone
button inside Claude Code's terminal: click, speak, send.

```
                                                        ╭───╮
                                                        │ 🎙 │      ready
                                                        ╰───╯
❯ _

                         ╭───────────────────────────────────╮
                         │ ● 0:07    × Cancel    🎙  Send     │      listening
                         ╰───────────────────────────────────╯
❯ fix the failing test in the parser and explain why it broke
```

## What it does

```
click 🎙  →  speak  →  click Send  →  Claude gets your prompt
```

```
Esc or Cancel  →  nothing is sent
```

Your words appear in the prompt while you speak. Anything you had already typed is
kept aside and comes back after the voice prompt is sent.

## Features

- Click to dictate, click to send
- Cancel any time with Esc; nothing is sent
- Keyboard shortcut: Alt+D
- Uses Claude Code's own voice dictation
- No extra API key, no extra speech service, no extra cost

## Requirements

- Windows 10 or 11
- [Claude Code](https://code.claude.com) signed in with a Claude.ai account (voice
  dictation is not available with an API key, Bedrock, Vertex or Foundry)
- A microphone available to your computer (built-in, USB, Bluetooth or a headset)
- [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows)
  for the installer: `winget install Microsoft.PowerShell`

## Install

```powershell
git clone https://github.com/augbastos/dictate-cli
cd dictate-cli
pwsh -File scripts\install.ps1
```

Then open Claude Code as usual. The 🎙 button appears above the prompt.

## Use

**Mouse**

1. Click 🎙 and speak.
2. Click **Send**.

**Keyboard**

1. Press **Alt+D** and speak.
2. Press **Alt+D** again to send.

**Cancel:** press **Esc** or click **Cancel**. Nothing is sent.

Point at 🎙 to see a short hint. `/dictate settings` shows your shortcut and
dictation language.

## Language

DictateCLI follows Claude Code's own voice language. It does not pick or force a
language.

To dictate in another language, set Claude Code's `language` setting, for example
`"language": "portuguese"` in `~/.claude/settings.json` (or through `/config`).
Note that this setting also changes the language Claude answers in.

## Privacy

DictateCLI itself:

- does not record or store audio;
- does not use any other transcription service;
- adds no telemetry and runs no background process.

The recording and the transcription are done by Claude Code's built-in voice
dictation, which sends the audio to Anthropic. See Claude Code's
[voice dictation](https://code.claude.com/docs/en/voice-dictation) and data usage
documentation.

## Platform support

| Platform | Status |
|---|---|
| Windows 10/11 (x64) | Supported |
| Windows on ARM | Not tested |
| macOS | Not supported in this release |
| Linux | Not supported in this release |

DictateCLI runs inside Claude Code, so it is not tied to a specific editor. It is
tested in the VS Code integrated terminal. See [docs/compatibility.md](docs/compatibility.md).

## Uninstall

```powershell
pwsh -File scripts\uninstall.ps1
```

This removes DictateCLI and restores the settings it changed. Your language setting
is left alone.

## Troubleshooting

- **The 🎙 button does not react to clicks.** Mouse clicks need Claude Code's
  fullscreen mode. The installer turns it on; open a new Claude Code session.
- **Nothing happens when I speak.** Check that your microphone is allowed in Windows
  Settings → Privacy & security → Microphone, and that Claude Code's own `/voice`
  works.
- **My words come out in English.** Set Claude Code's `language` setting (see
  Language).
- **Alt+D does nothing.** Run the installer again, then start a new Claude Code
  session.
- **"Could not reach Claude Code voice."** Run the installer again.

## How it works

DictateCLI is a small Claude Code plugin. It draws the button and drives Claude
Code's own voice dictation; it has no speech engine of its own. Details are in
[docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
