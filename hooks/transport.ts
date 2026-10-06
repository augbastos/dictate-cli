// The Windows voice transport: how DictateCLI reaches Claude Code's own voice.
//
// The mod API has no call to start or stop native dictation, so the tiny helper
// `bin/dictate-key.exe` (source: helper/dictate-key.cs) does it for the Claude Code
// process that started it. It takes exactly one argument from a fixed list:
//   "f11"    press Claude Code's voice key (bound to voice:pushToTalk)
//   "escape" press Claude Code's voice cancel
//   "mic"    read-only: is that process using the microphone? exit 10 yes, 11 no, 12 unknown
// Nothing else reaches it: no transcript text, no user input.

export type TransportKey = 'f11' | 'escape'
export const TRANSPORT_KEYS: readonly TransportKey[] = ['f11', 'escape']
export type Mic = 'on' | 'off' | 'unknown'

export function helperArgv(root: string, op: TransportKey | 'mic'): string[] {
  return [`${root}/bin/dictate-key.exe`, op]
}

export function micFrom(exitCode: number): Mic {
  return exitCode === 10 ? 'on' : exitCode === 11 ? 'off' : 'unknown'
}
