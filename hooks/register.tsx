import type { EngineInterface, Register } from 'claude-code'

import { merge } from './merge'
import { shortcutOf } from './shortcut'

// DictateCLI: voice dictation for Claude Code. A card above the prompt (and an
// optional key bound to `command:dictate`) drive Claude Code's own voice dictation
// (`/voice`, tap mode). Both inputs call the same toggle() and cancel(). The
// speech-to-text is Claude Code's; DictateCLI keeps what you had typed, sends once,
// and draws the state.
//
// Two keys, never the same one:
// - USER SHORTCUT: a key bound to `command:dictate` runs /dictate, which calls
//   toggle(). It never reaches Claude Code's voice directly. (Function keys such as
//   F9 never reach Claude Code's keybindings, so they cannot be that key.)
// - TRANSPORT: the helper writes F11 into Claude Code's console, bound to
//   `voice:pushToTalk`. F11 is the terminal's own fullscreen key in VS Code and
//   Windows Terminal, so a physical F11 never reaches Claude Code.
// The helper only accepts `f11` and `escape`, so a toggle can never press the
// user shortcut again (no shortcut → DictateCLI → shortcut loop).

type Phase = 'idle' | 'recording' | 'transcribing' | 'error'
export type TransportKey = 'f11' | 'escape'
export const TRANSPORT_KEYS: readonly TransportKey[] = ['f11', 'escape']
export const COMMAND = 'dictate'

const POLL_MS = 250
// Under 3 words Claude Code inserts the transcript without sending it: once the
// draft has stood still this long after stop, DictateCLI sends it.
const SETTLE_POLLS = 6
const GIVE_UP_MS = 12_000
// On stop, DictateCLI waits this long for a live transcript to show. None means nothing
// was heard, or Claude Code stopped listening (an Esc before the first word): then
// DictateCLI never presses the voice key blind (that could start a new recording).
const HEARD_MS = 1500
// A prompt that empties by itself (Esc cancelled Claude Code's recording, or it sent
// the transcript): it must stay empty this many looks, this far apart, to be a cancel.
const CONFIRM_MS = 600
const CONFIRM_LOOKS = 2
// Claude Code's voice stops by itself after 15 s of silence. With no word for longer
// than that, it is not recording any more (silence, or an Esc before the first word,
// which DictateCLI cannot see): the card goes back to idle and the draft comes back.
export const NO_SPEECH_MS = 16_000
const KEY_GAP_MS = 150
const DRAFT_BACK_MS = 300
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
let isStarting = false // start() in flight: a press now would race its F11
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
  $.ui.toast(`DictateCLI: ${text}`)
  $.clock.after(ERROR_MS, () => {
    if (phase === 'error') show($, 'idle')
  })
}

// The draft back in the prompt, in front of anything typed meanwhile.
function withDraft(typed: string) {
  if (typed === '') return base
  if (base === '') return typed
  return /\s$/.test(base) ? base + typed : `${base} ${typed}`
}

// A click on the card makes the band above the prompt take the keyboard; there Esc
// only leaves the band and never reaches Claude Code's voice cancel. The band lets go
// as soon as the prompt's text changes, so change it and put it back: the keyboard
// returns to the prompt through the official prompt API, with no key injected.
async function releaseKeyboard($: EngineInterface) {
  const { text } = await $.prompt.read()
  if (!(await $.prompt.fill({ text: `${text} ` })).isFilled) return false
  if ((await $.prompt.fill({ text })).isFilled) return true
  return (await $.prompt.fill({ text })).isFilled // one retry: never leave the extra space
}

async function restore($: EngineInterface) {
  run++
  show($, 'idle')
  await $.prompt.fill({ text: withDraft((await $.prompt.read()).text) })
}

// A dictation is a prompt of its own: what was said is sent alone, and what had been
// typed comes back to the prompt untouched, once the send has cleared it.
async function giveDraftBack($: EngineInterface) {
  if (base === '') return
  await $.clock.sleep(DRAFT_BACK_MS)
  if ((await $.prompt.read()).text === '') await $.prompt.fill({ text: base })
}

async function finish($: EngineInterface, id: number, transcript: string) {
  if (run !== id) return // Claude Code already sent it
  run++
  const text = transcript.trim()
  show($, 'idle')
  if (text === '') {
    await $.prompt.fill({ text: base })
    return
  }
  await $.prompt.fill({ text: '' })
  try {
    await $.prompt.submit({ text })
  } catch {
    // never lose it: draft and transcript back in the prompt, unsent
    await $.prompt.fill({ text: merge(base, text) ?? base })
    $.ui.toast('DictateCLI: could not send; the text is in the prompt')
    return
  }
  await giveDraftBack($)
}

// The prompt emptied by itself: Claude Code either sent the transcript (the
// prompt.submit hook bumps `run`) or Esc cancelled its recording. Tell them apart.
async function isCancelledNatively($: EngineInterface, id: number) {
  for (let look = 0; look < CONFIRM_LOOKS; look++) {
    await $.clock.sleep(CONFIRM_MS)
    if (run !== id || (await $.prompt.read()).text !== '') return false
  }
  return run === id
}

// While recording, Esc goes straight to Claude Code's own cancel; DictateCLI sees the
// live transcript vanish and gives the draft back.
async function watchRecording($: EngineInterface, id: number) {
  let hasText = false
  const since = await $.clock.now()
  while (run === id && phase === 'recording') {
    await $.clock.sleep(POLL_MS)
    if (run !== id || phase !== 'recording') return
    const { text } = await $.prompt.read()
    if (text !== '') hasText = true
    else if (hasText && (await isCancelledNatively($, id)) && phase === 'recording') return restore($)
    else if (!hasText && (await $.clock.now()) - since > NO_SPEECH_MS && run === id && phase === 'recording') return restore($)
  }
}

async function start($: EngineInterface) {
  if (phase === 'recording' || phase === 'transcribing') return
  isStarting = true
  try {
    await startRecording($)
  } finally {
    isStarting = false
  }
}

async function startRecording($: EngineInterface) {
  startedAt = Date.now()
  show($, 'recording')
  const id = ++run
  base = (await $.prompt.read()).text
  // Claude Code's tap mode only starts on an empty prompt; the draft comes back on send or ×.
  if (base !== '' && !(await $.prompt.fill({ text: '' })).isFilled) {
    return fail($, 'the prompt is busy')
  }
  // A non-empty draft just changed already. The prompt must be empty again: tap mode
  // starts only on an empty prompt.
  if (base === '' && !(await releaseKeyboard($)) && (await $.prompt.read()).text !== '') {
    return fail($, 'the prompt is busy')
  }
  if (!(await press($, 'f11'))) {
    return fail($, 'could not reach Claude Code voice; run scripts/install.ps1')
  }
  detach($, watchRecording($, id))
}

async function stop($: EngineInterface) {
  if (phase !== 'recording') return
  show($, 'transcribing')
  const id = run
  // Nothing on screen yet: give a short utterance a moment to show up.
  const heardBy = (await $.clock.now()) + HEARD_MS
  while ((await $.prompt.read()).text === '' && (await $.clock.now()) < heardBy) {
    await $.clock.sleep(POLL_MS)
    if (run !== id) return
  }
  if (run !== id) return
  if ((await $.prompt.read()).text === '') {
    // Nothing heard, or Claude Code stopped listening already. Esc cancels a recording
    // that may still run; never while a turn runs (there Esc would interrupt it, and a
    // silent recording stops by itself). Nothing is sent either way.
    if (!isWorking) await press($, 'escape')
    return restore($)
  }
  if (!(await press($, 'f11'))) {
    await press($, 'escape')
    return fail($, 'could not stop the recording')
  }
  const startedWaiting = await $.clock.now()
  let last = ''
  let same = 0
  while ((await $.clock.now()) < startedWaiting + GIVE_UP_MS) {
    await $.clock.sleep(POLL_MS)
    if (run !== id) return // Claude Code sent it: the prompt.submit hook merged it
    const { text } = await $.prompt.read()
    if (run !== id) return
    if (text === '' && last !== '' && (await isCancelledNatively($, id))) return restore($) // Esc while transcribing
    if (run !== id) return
    same = text === last ? same + 1 : 0
    last = text
    if (text.trim() !== '' && same >= SETTLE_POLLS) return finish($, id, text)
  }
  if (run !== id) return
  if (last.trim() !== '') return finish($, id, last)
  return restore($)
}

async function cancel($: EngineInterface) {
  if (phase !== 'recording' && phase !== 'transcribing') return
  run++
  show($, 'idle')
  // Esc is Claude Code's own cancel: it drops the audio and the transcript. While a
  // turn runs, an Esc that Claude Code's voice does not take would interrupt the turn:
  // then Esc goes only when the live transcript shows Claude Code is listening.
  const isListening = (await $.prompt.read()).text !== ''
  await releaseKeyboard($) // a click on Cancel put the keyboard in the band: Esc must reach the voice
  const isCancelled = !isWorking || isListening ? await press($, 'escape') : false
  await $.clock.sleep(KEY_GAP_MS)
  // While recording the prompt holds only Claude Code's live transcript, which a cancel
  // discards: the prompt gets back exactly the draft, never a piece of the transcript.
  await $.prompt.fill({ text: base })
  if (!isCancelled) $.ui.toast('DictateCLI: press Esc if Claude Code is still recording')
}

// The one entry point for the mic button and the keyboard shortcut.
async function toggle($: EngineInterface) {
  if (isStarting) return // the start's own F11 has not gone out yet
  if (phase === 'recording') return stop($)
  if (phase === 'transcribing') return // one press, one transition: wait for the send
  return start($)
}

// Work left running after a press or a key. A failure is said, never swallowed; the
// module unloading mid-recording (a reload) also lands here.
function detach($: EngineInterface, work: Promise<unknown>) {
  work.catch(() => {
    try {
      $.ui.toast('DictateCLI stopped unexpectedly; check the prompt, then press again')
    } catch {
      // the module is gone (a reload): nothing left to tell
    }
  })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'DictateCLI: start voice dictation, or stop and send it (bind a key to command:dictate)',
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
    if (!isRepeat) detach($, toggle($)) // not awaited: a stop waits for the transcript
    return {}
  })

  // Claude Code sends a tap-mode transcript of 3+ words itself; the draft comes back after.
  on('prompt.submit', async ($, e, next) => {
    const isOurs = phase === 'recording' || phase === 'transcribing'
    if (!isOurs || e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    run++
    show($, 'idle')
    const sent = await next(e) // what was said, alone
    detach($, giveDraftBack($))
    return sent
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
    const onToggle = () => detach($, toggle($))
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
        {phase === 'idle' && <Button key="mic" label={`${icon.mic}  DictateCLI`} plain onPress={onToggle} />}
        {phase === 'idle' && hint !== '' && <Text dimColor>{`  ${hint}`}</Text>}
        {phase === 'recording' && <Text color="red">● {elapsed(Date.now())}   </Text>}
        {phase === 'recording' && <Button key="cancel" label={`${icon.cancel} Cancel`} plain dimColor onPress={() => detach($, cancel($))} />}
        {phase === 'recording' && <Text>   </Text>}
        {phase === 'recording' && <Button key="mic" label={`${icon.mic}  Send`} plain onPress={onToggle} />}
        {phase === 'transcribing' && <Text dimColor>{icon.mic}  Transcribing…   </Text>}
        {phase === 'transcribing' && <Button key="cancel" label={`${icon.cancel} Cancel`} plain dimColor onPress={() => detach($, cancel($))} />}
        {phase === 'error' && <Text color="red">{message}   </Text>}
        {phase === 'error' && <Button key="mic" label={`${icon.mic}  DictateCLI`} plain onPress={onToggle} />}
      </Box>
    )

    // Another plugin's tree beneath us (e.g. AFKSwitch drawn below DictateCLI): one row.
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
