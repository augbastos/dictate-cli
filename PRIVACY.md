# Privacy

DictateCLI runs no server and makes no network requests of its own.

## What it does

- draws a microphone button in Claude Code and fills or sends the prompt through Claude
  Code's own prompt API;
- runs its local helper, `bin/dictate-key.exe`, which presses Claude Code's voice key in
  the Claude Code console and reads, read-only, whether that process is using the
  microphone (from the Windows per-app microphone record);
- reads `~/.claude/keybindings.json` to show your shortcut;
- on `/dictate setup` or `/dictate remove` only, runs its own install or uninstall script
  locally, which changes or restores the Claude Code settings listed in `SECURITY.md`;
- does not record or store audio, and does not store transcripts;
- does not send telemetry or run analytics;
- does not create an account or require credentials;
- does not sell or share user data.

## Claude Code's voice dictation

Recording and transcription are done by Claude Code's built-in voice dictation, through
Anthropic, under Anthropic's own terms and privacy policy. DictateCLI does not control how
that audio is processed.

## Future changes

If a future version adds network services, telemetry or stored data, this policy will be
updated before that version is released.
