# DictateCLI

**Voice dictation for Claude Code.**

DictateCLI adds clickable voice dictation to Claude Code's terminal UI using Claude
Code's own (native) voice backend.

```
                                                        ╭───╮
                                                        │ 🎙 │      idle: just the mic
                                                        ╰───╯
❯ investiga esse erro e

               DictateCLI ╭───╮
  Click or Alt+D to dictate · Esc cancels │ 🎙 │      pointer on it: the tip
               /dictate settings ╰───╯

                         ╭───────────────────────────────────╮
                         │ ● 0:07    × Cancel    🎙  Send     │      recording
                         ╰───────────────────────────────────╯
❯
```

The card sits at the right end of the band right above the prompt. That is as close
to the dictation button of the Claude and ChatGPT apps as a mod can draw, because no
plugin can draw inside the prompt row itself.

A dictation is a prompt of its own: what you say is sent alone, and whatever you
had typed is set aside while you speak and comes back to the prompt afterwards,
untouched.

## Use

| You | DictateCLI |
|---|---|
| click 🎤 **DictateCLI**, or **Alt+D** (or `/dictate`) | sets what you typed aside, clears the prompt, starts Claude Code voice |
| speak | Claude Code shows the live transcript in the prompt |
| click 🎤 **Send**, or **Alt+D** again | stops; Claude Code transcribes; what you said is sent once; your typed text comes back |
| click × **Cancel**, or press **Esc** | discards the recording and puts back exactly what you had typed |
| say nothing, then Send | nothing is sent; your text comes back |
| type while it transcribes | auto-send stops; your draft goes back in front of what you typed |

After a click on the card, the keyboard goes straight back to the prompt, so a single
Esc cancels.

### Keyboard

**Alt+D** to start, **Alt+D** again to transcribe and send, **Esc** to cancel. Alt+D
runs `/dictate` (keybinding `alt+d → command:dictate`), which toggles the same state
machine as the card; mouse and keyboard mix freely and the card always shows the
state. Holding Alt+D counts as one press.

Why not a single key:

- **Function keys (F9 and the rest) do not work.** Claude Code 2.1.289 and 2.1.290
  never route them to their keybindings. A function key bound to a command never
  runs it, while a letter chord (`alt+d`, `ctrl+y`) does (tested). `install.ps1`
  refuses them.
- **The Application/Menu key is not supported.** Claude Code's key reader has no
  name for it. Supporting it would need a global Windows keyboard hook or remap, and
  DictateCLI never changes what a key does outside Claude Code.

Another chord can be bound by hand to `command:dictate` in
`~/.claude/keybindings.json` (context `Chat`); the card shows whichever is bound.
`install.ps1 -Shortcut disabled` binds none.

## What it is (and is not)

DictateCLI is a Claude Code mod (a function-hooks plugin, `dictate-cli@dictate-cli`).
The command is `/dictate`. It draws the card and drives Claude Code's own `/voice`
dictation in tap mode. The speech-to-text is Claude Code's.

How it reaches the voice: the mod API has no call to start or stop native dictation.
So DictateCLI's helper (`bin/dictate-key.exe`) writes one key, **F11**, which is bound
to `voice:pushToTalk`, into the console of the Claude Code process that runs the mod.
It does this only on a click or `/dictate`. VS Code and Windows Terminal keep a
physical F11 for fullscreen, so your own F11 never bypasses DictateCLI. The helper
accepts only F11 and Esc.

It is not a voice assistant and not system-wide dictation. It has no text-to-speech,
no wake word, no conversation mode, no speech-to-text of its own, no server, no
telemetry and no background process.

## Requirements

- Windows 10 or 11 (the helper is Windows-only for now).
- Claude Code 2.1.287 or newer, with function-hook plugins (mods).
- A claude.ai login (voice dictation is not available with an API key, Bedrock,
  Vertex or Foundry) and a working microphone.
- The fullscreen renderer for mouse clicks (`install.ps1` turns it on).
- Dictation follows Claude Code's own `language` setting (see Settings and
  language).

## Install

```powershell
pwsh -NoProfile -File scripts\install.ps1
pwsh -NoProfile -File scripts\install.ps1 -Beside      # share the band row with AFKSwitch
```

Run it on every machine: the helper is built locally and never committed. It backs
up `~/.claude/settings.json` and `~/.claude/keybindings.json`, builds the helper with
the C# compiler that ships with Windows, installs the plugin from this folder, and
then:

- sets `voice: { enabled: true, mode: "tap" }` and `tui: "fullscreen"` in settings
  (`-NoFullscreen` skips the renderer change);
- in keybindings (context `Chat`): `alt+d → command:dictate`,
  `f11 → voice:pushToTalk`, and `space → null`, so typing a space never starts a
  recording.

New sessions show the card. A running session picks it up with `/reload-plugins`.

## Settings and language

`/dictate settings` opens a small panel (Esc closes it): how to start, send and
cancel, the shortcut, the dictation language and where options live.

DictateCLI has no language setting of its own: it uses Claude Code's voice, which
transcribes in Claude Code's `language` setting (`/config`, or `"language"` in
`~/.claude/settings.json`; English when unset). That setting also sets the language
Claude answers in. `install.ps1` never touches it.

## Options

In `/plugin` → dictate-cli → configure (or
`pluginConfigs["dictate-cli@dictate-cli"].options` in settings):

- `icon`: `nerd` (default, the Nerd Font microphone; needs a Nerd Font in the
  terminal) or `emoji` (🎤).
- `beside`: turn it on when another plugin draws a card in the same band (AFKSwitch,
  for one), so the two sit side by side instead of stacking.

## Privacy

DictateCLI keeps no audio and writes no files. Recording and transcription are
Claude Code's own: the audio is streamed to Anthropic for transcription and is not
processed locally (see Claude Code's voice dictation and data usage docs).

The helper writes exactly one key press (F11 or Esc) into the console of the Claude
Code process that started it, or reads (read-only) whether that process is using the
microphone. It accepts no other input, so nothing you say can become a command.

## Uninstall

```powershell
pwsh -NoProfile -File scripts\uninstall.ps1
```

It uninstalls the plugin and its marketplace, and puts back the `voice`, `tui`,
`alt+d`, `f9`, `f11` and `space` values recorded before the first install. It leaves your
`language` setting alone.

## Known limitations

- **Esc and the card.** Claude Code's voice takes Esc itself, and the mod API
  exposes no voice state. So DictateCLI watches two things: the live transcript
  vanishing, and Windows' own record of which app is using the microphone (the one
  behind the tray mic icon), which the helper reads for its Claude Code process.
  Esc closes the card in a fraction of a second either way. If that record is
  unavailable, the card falls back to closing after 16 s without a word (Claude
  Code's voice stops by itself after 15 s of silence).
- A word spoken right before stopping has 1.5 s to show up as live text; DictateCLI
  sends nothing it has not seen.
- No single-key shortcut (see Keyboard); Alt+D is the default chord.

## Troubleshooting

- **The card does not react to clicks.** Clicks need the fullscreen renderer
  (`tui: "fullscreen"`, or `CLAUDE_CODE_NO_FLICKER=1`).
- **"could not reach Claude Code voice".** Run `install.ps1` again to rebuild
  `bin/dictate-key.exe`.
- **REC shows but no text appears.** Check the microphone permission in Windows
  Settings → Privacy → Microphone, and that `/voice` works on its own.
- **Your language comes out as English words.** Set Claude Code's `language`
  setting (e.g. `"language": "portuguese"`) in `/config` or
  `~/.claude/settings.json`.

## License

MIT
