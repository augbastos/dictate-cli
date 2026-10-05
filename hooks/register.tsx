import type { EngineInterface, Register } from 'claude-code'

import { merge } from './merge'
import { shortcutOf } from './shortcut'

// Dictate: a card above the prompt and a keyboard shortcut (F9 by default) driving
// Claude Code's own voice dictation (`/voice`, tap mode). Both inputs call the same
// toggle() and cancel(). The speech-to-text is Claude Code's; Dictate keeps what you
// had typed, sends once, and draws the state.
//
// Two keys, never the same one:
// - USER SHORTCUT: F9 is bound to `command:dictate`, so a physical F9 runs /dictate,
//   which calls toggle(). It never reaches Claude Code's voice directly.
// - TRANSPORT: the helper writes F11 into Claude Code's console, bound to
//   `voice:pushToTalk`. F11 is the terminal's own fullscreen key in VS Code and
//   Windows Terminal, so a physical F11 never reaches Claude Code.
// The helper only accepts `f11` and `escape`, so a toggle can never press the
// user shortcut again (no F9 → Dictate → F9 loop).

type Phase = 'idle' | 'recording' | 'transcribing' | 'error'
export type TransportKey = 'f11' | 'escape'
export const TRANSPORT_KEYS: readonly TransportKey[] = ['f11', 'escape']
export const COMMAND = 'dictate'

const POLL_MS = 250
// Under 3 words Claude Code inserts the transcript without sending it: once the
// draft has stood still this long after stop, Dictate sends it.
const SETTLE_POLLS = 6
const GIVE_UP_MS = 12_000
// After stop, an empty prompt for this long means nothing was heard (or Claude
// Code was not recording any more): cancel whatever listens, give the draft back.
const SILENCE_MS = 4000
// A prompt that empties by itself (Esc cancelled Claude Code's recording, or it sent
// the transcript): look again after this long before calling it a cancel.
const CONFIRM_MS = 600
const KEY_GAP_MS = 150
const ERROR_MS = 2500
// A held key repeats; a press only counts after this long without one, which also
// spans Windows' longest initial repeat delay (1 s).
export const KEY_QUIET_MS = 1100
// Nerd Font glyphs (nf-md-microphone, nf-md-close) by default; `icon: emoji` for plain fonts.
const ICONS = {
  nerd: { mic: '\u{F036C}', cancel: '\u{F0156}' },
  emoji: { mic: '\u{1F3A4}', cancel: '×' },
}

// ponytail: module state is lost on a hot reload mid-recording; × or the next
// click recovers. Move it to $.state if that ever matters.
let phase: Phase = 'idle'
let base = ''
let run = 0 // bumped on every start, cancel and finish, so a stale poll stops
let message = ''
let isWorking = false // a turn is running: Esc would interrupt it
let lastKeyAt = -Infinity
let shortcut: string | undefined // the chord bound to /dictate, shown on the card

let startedAt = 0
let ticker: { cancel: () => void } | undefined // redraws the recording timer

function show($: EngineInterface, next: Phase) {
  phase = next
  ticker?.cancel()
  ticker = next === 'recording' ? $.clock.every(1000, () => $.ui.invalidate('ui.render')) : undefined
  $.ui.invalidate('ui.render')
}

function elapsed(now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function press($: EngineInterface, key: TransportKey) {
  try {
    const helper = `${$.plugin.root}/bin/dictate-key.exe`
    const { exitCode } = await $.process.run([helper, key], { timeoutMs: 5000 })
    return exitCode === 0
  } catch {
    return false
  }
}

async function fail($: EngineInterface, text: string) {
  run++
  await $.prompt.fill({ text: base })
  message = text
  show($, 'error')
  $.ui.toast(`Dictate: ${text}`)
  $.clock.after(ERROR_MS, () => {
    if (phase === 'error') show($, 'idle')
  })
}

async function restore($: EngineInterface) {
  run++
  await $.prompt.fill({ text: base })
  show($, 'idle')
}

async function finish($: EngineInterface, id: number, transcript: string) {
  if (run !== id) return // Claude Code already sent it
  run++
  const text = merge(base, transcript)
  show($, 'idle')
  if (text === null) {
    await $.prompt.fill({ text: base })
    return
  }
  await $.prompt.fill({ text: '' })
  await $.prompt.submit({ text })
}

// The prompt emptied by itself: Claude Code either sent the transcript (the
// prompt.submit hook bumps `run`) or Esc cancelled its recording. Tell them apart.
async function isCancelledNatively($: EngineInterface, id: number) {
  await $.clock.sleep(CONFIRM_MS)
  if (run !== id) return false
  return (await $.prompt.read()).text === ''
}

// While recording, Esc goes straight to Claude Code's own cancel; Dictate sees the
// live transcript vanish and gives the draft back.
async function watchRecording($: EngineInterface, id: number) {
  let hasText = false
  while (run === id && phase === 'recording') {
    await $.clock.sleep(POLL_MS)
    if (run !== id || phase !== 'recording') return
    const { text } = await $.prompt.read()
    if (text !== '') hasText = true
    else if (hasText && (await isCancelledNatively($, id)) && phase === 'recording') return restore($)
  }
}

async function start($: EngineInterface) {
  if (phase === 'recording' || phase === 'transcribing') return
  startedAt = Date.now()
  show($, 'recording')
  const id = ++run
  base = (await $.prompt.read()).text
  // Claude Code's tap mode only starts on an empty prompt; the draft comes back on send or ×.
  if (base !== '' && !(await $.prompt.fill({ text: '' })).isFilled) {
    return fail($, 'the prompt is busy')
  }
  if (!(await press($, 'f11'))) {
    return fail($, 'could not reach Claude Code voice; run scripts/install.ps1')
  }
  detach(watchRecording($, id))
}

async function stop($: EngineInterface) {
  if (phase !== 'recording') return
  show($, 'transcribing')
  const id = run
  if (!(await press($, 'f11'))) {
    await press($, 'escape')
    return fail($, 'could not stop the recording')
  }
  const startedWaiting = await $.clock.now()
  let last = ''
  let same = 0
  let hasText = false
  while ((await $.clock.now()) < startedWaiting + GIVE_UP_MS) {
    await $.clock.sleep(POLL_MS)
    if (run !== id) return // Claude Code sent it: the prompt.submit hook merged it
    const { text } = await $.prompt.read()
    if (run !== id) return
    if (text !== '') hasText = true
    if (text === '' && hasText && (await isCancelledNatively($, id))) return restore($) // Esc while transcribing
    if (run !== id) return
    if (text === '' && !hasText && (await $.clock.now()) - startedWaiting >= SILENCE_MS) break
    same = text === last ? same + 1 : 0
    last = text
    if (text.trim() !== '' && same >= SETTLE_POLLS) return finish($, id, text)
  }
  if (run !== id) return
  if (last.trim() !== '') return finish($, id, last)
  // Nothing heard: make sure nothing is still listening, give the draft back.
  if (!isWorking) await press($, 'escape')
  await restore($)
}

async function cancel($: EngineInterface) {
  if (phase !== 'recording' && phase !== 'transcribing') return
  run++
  show($, 'idle')
  // Esc is Claude Code's own cancel: it drops the audio and the transcript.
  const isCancelled = await press($, 'escape')
  await $.clock.sleep(KEY_GAP_MS)
  await $.prompt.fill({ text: base })
  if (!isCancelled) $.ui.toast('Dictate: press Esc to stop the recording')
}

// The one entry point for the mic button and the keyboard shortcut.
async function toggle($: EngineInterface) {
  if (phase === 'recording') return stop($)
  if (phase === 'transcribing') return // one press, one transition: wait for the send
  return start($)
}

// Work left running after a press or a key: the only rejection it can meet is the
// module unloading mid-recording (a reload), and the next press recovers from that.
function detach(work: Promise<unknown>) {
  work.catch(() => undefined)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Dictate: start voice dictation, or stop and send it (bind a key to command:dictate)',
      immediate: true,
    })
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    try {
      if (home) shortcut = shortcutOf(await $.fs.read(`${home}/.claude/keybindings.json`))
    } catch {
      shortcut = undefined // no keybindings.json: no shortcut to show
    }
    $.ui.invalidate('ui.render')
    return started
  })

  // The keyboard shortcut: a key bound to `command:dictate` runs /dictate.
  on('command.run', { command: COMMAND }, async $ => {
    const now = await $.clock.now()
    const isRepeat = now - lastKeyAt < KEY_QUIET_MS
    lastKeyAt = now
    if (!isRepeat) detach(toggle($)) // not awaited: a stop waits for the transcript
    return {}
  })

  // Claude Code sends a tap-mode transcript of 3+ words itself: put the draft in front.
  on('prompt.submit', async ($, e, next) => {
    const isOurs = phase === 'recording' || phase === 'transcribing'
    if (!isOurs || e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    run++
    show($, 'idle')
    const text = merge(base, e.text)
    return next(text === null ? e : { ...e, text })
  })

  // Typing while Claude Code transcribes: the person takes over. Stop auto-sending
  // and put the draft back in front of what is there.
  on('prompt.edit', async ($, e, next) => {
    if (phase !== 'transcribing' || e.key === undefined) return next(e)
    run++
    show($, 'idle')
    const edited = await next(e)
    const gap = base === '' || edited.text === '' || /\s$/.test(base) ? '' : ' '
    const prefix = base + gap
    return { ...edited, text: prefix + edited.text, cursor: prefix.length + edited.cursor }
  })

  // A bordered card at the right of the band right above the prompt (no site draws
  // inside the prompt row), as present as AFKSwitch's switch. Whatever other plugins
  // draw in the band stays, to the left.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isWorking = e.props.isWorking
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const icon = ICONS[options.icon === 'emoji' ? 'emoji' : 'nerd']
    const others = await next(e)
    const onToggle = () => detach(toggle($))
    const hint = shortcut === undefined ? '' : shortcut.toUpperCase()

    const card = (
      <Box
        flexDirection="row"
        flexShrink={0}
        borderStyle="round"
        borderColor={phase === 'recording' || phase === 'error' ? 'red' : undefined}
        borderDimColor={phase === 'idle'}
        paddingX={1}
      >
        {phase === 'idle' && <Button key="mic" label={`${icon.mic}  Dictate`} plain onPress={onToggle} />}
        {phase === 'idle' && hint !== '' && <Text dimColor>{`  ${hint}`}</Text>}
        {phase === 'recording' && <Text color="red">● {elapsed(Date.now())}   </Text>}
        {phase === 'recording' && <Button key="cancel" label={`${icon.cancel} Cancel`} plain dimColor onPress={() => detach(cancel($))} />}
        {phase === 'recording' && <Text>   </Text>}
        {phase === 'recording' && <Button key="mic" label={`${icon.mic}  Send`} plain onPress={onToggle} />}
        {phase === 'transcribing' && <Text dimColor>{icon.mic}  Transcribing…   </Text>}
        {phase === 'transcribing' && <Button key="cancel" label={`${icon.cancel} Cancel`} plain dimColor onPress={() => detach(cancel($))} />}
        {phase === 'error' && <Text color="red">{message}   </Text>}
        {phase === 'error' && <Button key="mic" label={`${icon.mic}  Dictate`} plain onPress={onToggle} />}
      </Box>
    )

    // Another plugin's tree beneath us (e.g. AFKSwitch drawn below Dictate): one row.
    const isBottom = others === null || others === undefined || (others as { type?: unknown }).type === 'engine'
    if (!isBottom) {
      return (
        <Box flexDirection="row" alignItems="flex-end">
          {others}
          <Box flexGrow={1} />
          {card}
        </Box>
      )
    }
    // We are the bottom of the chain. With `beside`, a plugin drawn above us in the
    // band (AFKSwitch) shares our rows instead of stacking under the card: the card's
    // own Box pulls the next sibling up (a Box clips what overflows it, so the margin
    // sits on the outermost Box). The engine's node is left out there: under a Box
    // with a margin it is refused, and with no survey (checked above) it draws nothing.
    if (options.beside === true) {
      return (
        <Box flexDirection="row" justifyContent="flex-end" marginBottom={-3}>
          {card}
        </Box>
      )
    }
    // No width or margin on any Box around `others`: the engine refuses its node there.
    return (
      <Box flexDirection="column">
        {others}
        <Box flexDirection="row" justifyContent="flex-end">
          {card}
        </Box>
      </Box>
    )
  })
}
