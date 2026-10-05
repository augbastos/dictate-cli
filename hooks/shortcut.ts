// The chord bound to `command:dictate` in a keybindings.json text, if any.
export function shortcutOf(keybindingsJson: string): string | undefined {
  const parsed: unknown = JSON.parse(keybindingsJson)
  const blocks = (parsed as { bindings?: unknown }).bindings
  if (!Array.isArray(blocks)) return undefined
  for (const block of blocks) {
    const bindings = (block as { context?: unknown; bindings?: unknown }).bindings
    if ((block as { context?: unknown }).context !== 'Chat' || typeof bindings !== 'object' || bindings === null) continue
    for (const [chord, action] of Object.entries(bindings)) {
      if (action === 'command:dictate') return chord
    }
  }
  return undefined
}
