# How DictateCLI works

DictateCLI is a Claude Code mod: a plugin of function hooks
(`dictate-cli@dictate-cli`) plus a tiny Windows helper. It never records audio and
has no speech engine. Recording, streaming and transcription are Claude Code's own
voice dictation (`/voice`, tap mode).

## Pieces

| Path | What it is |
|---|---|
| `hooks/register.tsx` | The mod: the state machine, the button, `/dictate`, and the hooks |
| `hooks/merge.ts` | How typed text and a transcript join (failure fallback) |
| `hooks/shortcut.ts` | Reads the chord bound to `command:dictate` for the hint |
| `helper/dictate-key.cs` | The helper, built locally into `bin/dictate-key.exe` |
| `scripts/install.ps1`, `scripts/uninstall.ps1` | Install, upgrade, rollback |
| `hooks/*.test.ts` | Tests, run by `claude plugin test` |

## State machine

`IDLE → RECORDING → TRANSCRIBING → IDLE`, plus `ERROR` (shown for 2.5 s, then
`IDLE`). The mic button, `/dictate` and the Alt+D keybinding all call one
`toggle()`; Cancel calls `cancel()`. There is one implementation for mouse and
keyboard.

- **Start:** the typed draft is set aside and the prompt emptied, because Claude
  Code's tap mode starts only on an empty prompt. Then the voice key is pressed.
- **Stop:** the voice key is pressed again. Claude Code sends a transcript of three
  words or more by itself; DictateCLI sends shorter ones once they stop changing
  (1.5 s). Exactly one prompt is sent. The draft comes back afterwards.
- **Cancel:** Esc is Claude Code's own voice cancel. DictateCLI sees it in two ways:
  the live transcript disappears, or Windows reports that Claude Code released the
  microphone. Either way the draft comes back and nothing is sent.
- **Guards:** a 1.1 s key-repeat window (a held Alt+D counts as one press), no press
  accepted while a start is in flight, and stale work stopped by a run counter.

## Reaching Claude Code's voice (Windows)

The mod API has no call to start or stop native dictation. So the helper writes one
key into the console of the Claude Code process that started it
(`AttachConsole(parent)` + `WriteConsoleInputW`):

- `f11`: bound to `voice:pushToTalk` by the installer. VS Code and Windows Terminal
  use a physical F11 for fullscreen, so a person never presses it by accident.
- `escape`: Claude Code's voice cancel.
- `mic` (read only): reads Windows' per-app microphone record
  (`CapabilityAccessManager\ConsentStore\microphone\NonPackaged\<exe>`,
  `LastUsedTimeStop` = 0 while in use) for its parent process.

The helper takes exactly one argument from that fixed list. Anything else exits
with code 64. No text from a transcript ever reaches it.

The user's shortcut is a separate key (`alt+d → command:dictate`), so DictateCLI can
never press its own shortcut. Function keys cannot be used as the shortcut, because
Claude Code does not route them to keybindings.

## Focus after a click

A click on the button makes the band above the prompt hold the keyboard. There, Esc
would only leave the band. The band lets go whenever the prompt text changes, so
DictateCLI changes the prompt and puts it back through Claude Code's prompt API.

## Install and rollback

`install.ps1`:
1. backs up `settings.json` and `keybindings.json`;
2. records the values it will change (once, in `~/.claude/backups/dictate-cli-previous.json`);
3. builds the helper with the C# compiler included in Windows (.NET Framework 4);
4. installs the plugin from the folder;
5. sets `voice` (tap mode) and the fullscreen renderer;
6. binds `alt+d`, `f11` and `space → null`.

It never writes `language`. `uninstall.ps1` restores exactly the recorded values and
removes only what DictateCLI added.

## Limits

- Windows only for now: the helper uses Windows console APIs.
- Clicks need Claude Code's fullscreen renderer (it reports the mouse).
- If Windows' microphone record is unavailable, an Esc before any word closes the
  button after 16 s (Claude Code's voice stops itself after 15 s of silence).
