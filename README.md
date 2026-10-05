# Dictate

A clickable mic for Claude Code's built-in voice dictation.

Click the microphone to start.
Click it again to send.
Click × to discard.

```
                                             ╭──────────────╮
                                             │ 🎤  Dictate  │      idle
                                             ╰──────────────╯
❯ investiga esse erro e

                         ╭───────────────────────────────────╮
                         │ ● 0:07    × Cancel    🎤  Send     │      recording
                         ╰───────────────────────────────────╯
❯
```

The controls sit at the right end, right above the prompt row, in the band Claude
Code keeps there for plugins: as close to the dictation button of the Claude and
ChatGPT apps as a mod can draw (no plugin can draw inside the prompt row itself).

Whatever you had typed stays: `investiga esse erro e` + spoken
`compara com a versão anterior` is sent as one prompt.

## What it is (and is not)

Dictate is a Claude Code mod (function hooks plugin). It draws the buttons on the
hint line under the prompt and drives Claude Code's own `/voice` dictation (tap
mode) by pressing its keybinding for you. The speech-to-text is Claude Code's.

It is not a voice assistant: no text-to-speech, no wake word, no conversation mode,
no speech-to-text of its own, no server, no telemetry.

## Requirements

- Windows 10 or 11 (the key helper is Windows-only for now).
- Claude Code 2.1.287 or newer with function-hook plugins (mods).
- A claude.ai login (voice dictation is not available with an API key, Bedrock,
  Vertex or Foundry) and a working microphone.
- The fullscreen renderer for mouse clicks (`install.ps1` turns it on).

## Install

```powershell
pwsh -NoProfile -File scripts\install.ps1
```

It backs up `~/.claude/settings.json` and `~/.claude/keybindings.json`, builds the
helper with the C# compiler that ships with Windows, and then:

- sets `voice: { enabled: true, mode: "tap" }` and `tui: "fullscreen"` in settings
  (`-NoFullscreen` skips the renderer change);
- binds `F9` to `voice:pushToTalk` and unbinds `Space` from it, so typing a space
  never starts a recording;
- installs the plugin from this folder (`claude plugin marketplace add`, then
  `claude plugin install dictate@dictate`).

New sessions show the mic. A running session picks it up with `/reload-plugins`.

## Use

| You | Dictate |
|---|---|
| click 🎤 | keeps what you typed, clears the prompt, starts Claude Code voice |
| speak | Claude Code shows the live transcript in the prompt |
| click 🎤 again | stops; Claude Code transcribes; your text + the transcript is sent once |
| click × (or Esc) | discards the recording and puts back exactly what you had typed |
| say nothing, then 🎤 | nothing is sent; your text comes back |

Keyboard: `F9` toggles Claude Code's dictation directly. It starts only on an empty
prompt, because that is how Claude Code's tap mode works. `Esc` cancels.

## Options

In `/plugin` → dictate → configure (or `pluginConfigs.dictate` in settings):

- `icon`: `nerd` (default, the Nerd Font microphone; needs a Nerd Font in the
  terminal) or `emoji` (🎤).
- `beside`: turn on when another plugin draws a card in the same band above
  Dictate's (AFKSwitch, for one), so the two sit side by side instead of stacking.

## Privacy

Dictate keeps no audio and writes no files. Recording and transcription are Claude
Code's own: the audio is streamed to Anthropic for transcription and is not
processed locally (see Claude Code's voice dictation and data usage docs).

The helper `bin/dictate-key.exe` writes exactly one key press (`F9` or `Esc`) into
the console of the Claude Code process that started it, and only when you click.
It accepts no other input, so nothing you say can become a command.

## Uninstall

```powershell
pwsh -NoProfile -File scripts\uninstall.ps1
```

It uninstalls the plugin, puts back the `voice` and `tui` values from before the
install, and removes the `F9` and `Space` bindings Dictate added.

## Troubleshooting

- **The mic does not react to clicks.** Clicks need the fullscreen renderer
  (`tui: "fullscreen"`, or `CLAUDE_CODE_NO_FLICKER=1`).
- **"could not reach Claude Code voice".** Run `install.ps1` again to rebuild
  `bin/dictate-key.exe`.
- **REC shows but no text appears.** Check the microphone permission in Windows
  Settings → Privacy → Microphone, and that `/voice` works on its own (`F9` on an
  empty prompt).
- **One- or two-word dictations are not sent by Claude Code.** Dictate sends them
  itself about 1.5 s after the transcript stops changing.

## License

MIT
