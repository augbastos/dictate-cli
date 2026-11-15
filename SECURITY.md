# Security

## What DictateCLI can do

- Draw a button in Claude Code and send prompts through Claude Code's own prompt API.
- Run its helper, `bin/dictate-key.exe`, with one fixed argument:
  - `f11` and `escape` write one key press into the console of the Claude Code
    process that started it;
  - `mic` reads, read-only, whether that process is using the microphone.
- Read the prompt box while you dictate, `~/.claude/keybindings.json` to show the
  shortcut, and Claude Code's settings to show the voice `language`.
- On `/dictate setup` or `/dictate remove`, and only then, run its own
  `scripts/install.ps1` or `scripts/uninstall.ps1` with PowerShell 7 (`-SkipPlugin`):
  the same changes as the installer below (including building the helper into the
  plugin's `bin/` with Windows' `csc.exe`, a `claude --version` check, and a backup in
  `~/.claude/backups`), and their undo. PowerShell is run
  from its install path, `%ProgramFiles%\PowerShell\7\pwsh.exe`.

It does not record audio, store transcripts, open network connections, or send
telemetry. Recording and transcription are Claude Code's own voice dictation.

The installer changes `voice` and `tui` (unless `-NoFullscreen`) in
`~/.claude/settings.json`, and sets `f11`, `space` and `alt+d` (unless
`-Shortcut disabled`) in `~/.claude/keybindings.json`. It writes
`pluginConfigs["dictate-cli@dictate-cli"]` only with `-Beside` or to carry over the
options of an install under the former name (Dictate), whose
`pluginConfigs["dictate@dictate"]` it removes. With `-Shortcut disabled` it also removes
an `f9` bound to `command:dictate` or `voice:pushToTalk`. It copies
both files to `~/.claude/backups` first and records the previous values in
`backups/dictate-cli-previous.json`. The uninstaller restores those values, removes the
`enabledPlugins` and `extraKnownMarketplaces` keys if they are empty and were not there
before, deletes a file only if DictateCLI had created it, and deletes its record.

## Reporting a problem

Please report security issues privately through GitHub's "Report a vulnerability"
(Security tab) rather than a public issue.
