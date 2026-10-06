# Changelog

## 0.4.0

- `/dictate setup` and `/dictate remove`: set up (or undo) the helper, voice and keys
  for a plugin installed without the installer, for example with `/plugin`.
- Privacy, support and terms pages; listing metadata and icon.

## 0.3.2

- The installer checks Windows, PowerShell 7, the Claude Code version (2.1.287+) and
  the C# compiler first, and changes nothing if one is missing.
- `scripts/doctor.ps1`: read-only check that says what is wrong and how to fix it.
- Install, uninstall and restore are tested in CI against an isolated Claude config.
- Compatibility table: tested on Windows 11; Windows 10 expected to work, not yet tested.

## 0.3.1

- Repository prepared for publication: plain-language README, architecture, compatibility
  and security notes, CI.
- The installer requires PowerShell 7.

## 0.3.0

- Cleaner button: just the microphone. Name, shortcut and help show on hover.
- `/dictate settings` panel with the shortcut and the dictation language.
- Dictation language follows Claude Code's own setting.

## 0.2.x

- Esc always cancels, even before the first word (Windows microphone record).
- Alt+D shortcut. A dictation is sent as its own prompt; typed text comes back.
- Renamed from Dictate to DictateCLI.
- Keyboard focus returns to the prompt after a click, so one Esc cancels.

## 0.1.0

- First version: clickable mic over Claude Code's native voice dictation.
