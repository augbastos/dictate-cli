# Compatibility

Only combinations actually tested are marked as working.

## Operating systems

| OS | Status |
|---|---|
| Windows 11 x64 | Works (tested with a real microphone) |
| Windows 10 x64 | Expected to work, not tested |
| Windows on ARM | Not tested |
| macOS | Not supported in this release |
| Linux | Not supported in this release |

## Terminal hosts (Windows)

| Host | Status |
|---|---|
| VS Code integrated terminal | Works (tested) |
| Windows Terminal | Not tested |

## Claude Code

Tested with Claude Code 2.1.289–2.1.291. DictateCLI needs function-hook plugins
(mods), Claude Code 2.1.287 or newer, and a Claude.ai login for voice dictation.

Voice dictation runs on the machine where Claude Code runs. Over SSH or in a cloud
session, Claude Code's voice is not available, so neither is DictateCLI.
