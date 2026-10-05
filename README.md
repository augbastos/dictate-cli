# Dictate

Voice dictation for Claude Code, from a button or a key.

```
                                             ╭───────────────────╮
                                             │ 🎤  Dictate   F9  │      idle
                                             ╰───────────────────╯
❯ investiga esse erro e

                         ╭───────────────────────────────────╮
                         │ ● 0:07    × Cancel    🎤  Send     │      recording
                         ╰───────────────────────────────────╯
❯
```

The card sits at the right end of the band right above the prompt. That is as close
to the dictation button of the Claude and ChatGPT apps as a mod can draw, because no
plugin can draw inside the prompt row itself.

Whatever you had typed stays: `investiga esse erro e` + spoken
`compara com a versão anterior` is sent as one prompt.

## Mouse

Click 🎤 **Dictate** to start.
Click 🎤 **Send** to transcribe and send.
Click × **Cancel**, or press Esc, to discard.

## Keyboard

F9 to start.
F9 again to transcribe and send.
Esc to cancel.

The mouse and the key drive the same thing. You can start with one and stop with
the other, and the card always shows the state. Holding F9 down counts as one press.

### The Application (Menu) key

Many Windows keyboards have an Application/Menu key that people rarely use, and it
would make a good dedicated Dictate key. It is **not supported**: Claude Code's key
reader has no name for that key, so no Claude Code keybinding can hold it.
Supporting it would mean a global Windows keyboard hook or a remap. Dictate
deliberately has neither: it never changes what a key does outside Claude Code.
`install.ps1 -Shortcut apps` explains this and changes nothing.

## What it is (and is not)

Dictate is a Claude Code mod (a function-hooks plugin). It draws the card and drives
Claude Code's own `/voice` dictation (tap mode). The speech-to-text is Claude
Code's.

How the keys fit together:

- **Your key (F9)** is bound to `command:dictate`, so it runs Dictate's `/dictate`
  command, which toggles Dictate. It never reaches Claude Code's voice directly.
- **The transport (F11)** is bound to `voice:pushToTalk`. Only Dictate's helper
  presses it, by writing it into the console of the Claude Code process that runs
  Dictate. VS Code and Windows Terminal both keep a physical F11 for fullscreen, so
  your own F11 never bypasses Dictate. The helper accepts only F11 and Esc, so a
  toggle can never press F9 again.

It is not a voice assistant and not system-wide dictation. It has no text-to-speech,
no wake word, no conversation mode, no speech-to-text of its own, no server, no
telemetry and no background process.

## Requirements

- Windows 10 or 11 (the key helper is Windows-only for now).
- Claude Code 2.1.287 or newer, with function-hook plugins (mods).
- A claude.ai login (voice dictation is not available with an API key, Bedrock,
  Vertex or Foundry) and a working microphone.
- The fullscreen renderer for mouse clicks (`install.ps1` turns it on). The keyboard
  works without it.

## Install

```powershell
pwsh -NoProfile -File scripts\install.ps1            # F9 (default)
pwsh -NoProfile -File scripts\install.ps1 -Shortcut disabled
```

Run it on every machine: the helper is built locally and never committed. It backs
up `~/.claude/settings.json` and `~/.claude/keybindings.json`, builds the helper with
the C# compiler that ships with Windows, installs the plugin from this folder, and
then:

- sets `voice: { enabled: true, mode: "tap" }` and `tui: "fullscreen"` in settings
  (`-NoFullscreen` skips the renderer change);
- in keybindings (context `Chat`): `f9 → command:dictate`,
  `f11 → voice:pushToTalk`, and `space → null`, so typing a space never starts a
  recording.

New sessions show the card. A running session picks it up with `/reload-plugins`.

## What happens

| You | Dictate |
|---|---|
| Dictate / F9 | keeps what you typed, clears the prompt, starts Claude Code voice |
| speak | Claude Code shows the live transcript in the prompt |
| Send / F9 | stops; Claude Code transcribes; your text + the transcript is sent once |
| Cancel / Esc | discards the recording and puts back exactly what you had typed |
| say nothing, then Send / F9 | nothing is sent; your text comes back |
| type while it transcribes | auto-send stops; your draft goes back in front of what you typed |

## Options

In `/plugin` → dictate → configure (or `pluginConfigs["dictate@dictate"].options` in
settings):

- `icon`: `nerd` (default, the Nerd Font microphone; needs a Nerd Font in the
  terminal) or `emoji` (🎤).
- `beside`: turn it on when another plugin draws a card in the same band (AFKSwitch,
  for one), so the two sit side by side instead of stacking.

## Privacy

Dictate keeps no audio and writes no files. Recording and transcription are Claude
Code's own: the audio is streamed to Anthropic for transcription and is not
processed locally (see Claude Code's voice dictation and data usage docs).

The helper `bin/dictate-key.exe` writes exactly one key press (F11 or Esc) into the
console of the Claude Code process that started it, and only on a click or F9. It
accepts no other input, so nothing you say can become a command.

## Uninstall

```powershell
pwsh -NoProfile -File scripts\uninstall.ps1
```

It uninstalls the plugin and puts back the `voice`, `tui`, `f9`, `f11` and `space`
values recorded before the first install.

## Known limitations

- An Esc pressed before any words show up cannot be seen by Dictate: the card stays
  on REC until the next press. That press finds nothing to send, cancels whatever
  still listens and gives your draft back.
- The Application/Menu key is not supported (see above).

## Troubleshooting

- **The mic does not react to clicks.** Clicks need the fullscreen renderer
  (`tui: "fullscreen"`, or `CLAUDE_CODE_NO_FLICKER=1`).
- **F9 does nothing.** Check `~/.claude/keybindings.json` for `"f9": "command:dictate"`
  in the `Chat` block, then `/reload-plugins`.
- **"could not reach Claude Code voice".** Run `install.ps1` again to rebuild
  `bin/dictate-key.exe`.
- **REC shows but no text appears.** Check the microphone permission in Windows
  Settings → Privacy → Microphone, and that `/voice` works on its own.
- **One- or two-word dictations are not sent by Claude Code.** Dictate sends them
  itself about 1.5 s after the transcript stops changing.

## License

MIT
