# Security

## What DictateCLI can do

- Draw a button in Claude Code and send prompts through Claude Code's own prompt API.
- Run its helper, `bin/dictate-key.exe`, with one fixed argument:
  - `f11` and `escape` write one key press into the console of the Claude Code
    process that started it;
  - `mic` reads, read-only, whether that process is using the microphone.
- Read `~/.claude/keybindings.json` to show the shortcut.
- On `/dictate setup` or `/dictate remove`, and only then, run its own
  `scripts/install.ps1` or `scripts/uninstall.ps1` with PowerShell 7 (`-SkipPlugin`):
  the same changes as the installer below (including building the helper into the
  plugin's `bin/` and a backup in `~/.claude/backups`), and their undo. PowerShell is run
  from its install path, `%ProgramFiles%\PowerShell\7\pwsh.exe`.

It does not record audio, store transcripts, open network connections, or send
telemetry. Recording and transcription are Claude Code's own voice dictation.

The installer changes only `voice`, `tui`, `pluginConfigs["dictate-cli@dictate-cli"]`
in `~/.claude/settings.json`, and the `alt+d`, `f11` and `space` bindings in
`~/.claude/keybindings.json`. It records the previous values, and the uninstaller
restores them.

## Reporting a problem

Please report security issues privately through GitHub's "Report a vulnerability"
(Security tab) rather than a public issue.
