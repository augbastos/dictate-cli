import type { EngineInterface, Register } from 'claude-code'

import { merge } from './merge'
import { shortcutOf } from './shortcut'
import { helperArgv, micFrom } from './transport'
import type { Mic, TransportKey } from './transport'

// DictateCLI: voice dictation for Claude Code. A card above the prompt (and an
// optional key bound to `command:dictate`) drive Claude Code's own voice dictation
// (`/voice`, tap mode). Both inputs call the same toggle() and cancel(). The
// speech-to-text is Claude Code's; DictateCLI sets aside what you had typed (it comes
// back after the send), sends the dictation once, and draws the state.
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
export const COMMAND = 'dictate'
const SETTINGS_PANE = 'dictate-cli-settings'

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
// With the microphone already released, one short look is enough to rule out a send.
const MIC_CONFIRM_MS = 200
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

// Work left running after a press or a key. A failure is said, never swallowed; the
// module unloading mid-recording (a reload) also lands here.
async function settle($: EngineInterface, work: Promise<unknown>) {
  try {
    await work
  } catch {
    try {
      $.ui.toast('DictateCLI stopped unexpectedly; check the prompt, then press again')
    } catch {
      // the module is gone (a reload): nothing left to tell
    }
  }
}

async function detach($: EngineInterface, work: Promise<unknown>) {
  settle($, work) // never rejects: it reports the failure itself
}

let tickRun = 0 // the one loop that redraws the recording timer

async function tick($: EngineInterface, id: number) {
  while (phase === 'recording' && id === tickRun) {
    await $.clock.sleep(1000)
    $.ui.invalidate('ui.render')
  }
}

async function clearError($: EngineInterface) {
  await $.clock.sleep(ERROR_MS)
  if (phase === 'error') {
    phase = 'idle'
    $.ui.invalidate('ui.render')
  }
}

// `alt+d` → `Alt+D`
export function chordLabel(chord: string) {
  return chord.split('+').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('+')
}

function elapsed(now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function press($: EngineInterface, key: TransportKey) {
  try {
    const { exitCode } = await $.process.run(helperArgv($.plugin.root, key), { timeoutMs: 5000 })
    return exitCode === 0
  } catch {
    return false
  }
}

// Is Claude Code using the microphone right now? Windows records it per app (the tray
// mic icon); the helper reads it for its parent, read-only. While recording with no
// word on screen this is the only sign that an Esc cancelled Claude Code's voice.
async function micState($: EngineInterface): Promise<Mic> {
  try {
    const { exitCode } = await $.process.run(helperArgv($.plugin.root, 'mic'), { timeoutMs: 5000 })
    return micFrom(exitCode)
  } catch {
    return 'unknown'
  }
}

async function fail($: EngineInterface, text: string) {
  run++
  await $.prompt.fill({ text: base })
  message = text
  phase = 'error'
  $.ui.invalidate('ui.render')
  $.ui.toast(`DictateCLI: ${text}`)
  const clearing = clearError($)
  detach($, clearing)
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
  phase = 'idle'
  $.ui.invalidate('ui.render')
  const { text } = await $.prompt.read()
  await $.prompt.fill({ text: withDraft(text) })
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
  phase = 'idle'
  $.ui.invalidate('ui.render')
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
  let isMicSeen = false
  const since = await $.clock.now()
  while (run === id && phase === 'recording') {
    await $.clock.sleep(POLL_MS)
    if (run !== id || phase !== 'recording') return
    const { text } = await $.prompt.read()
    if (text !== '') {
      hasText = true
      continue
    }
    if (hasText) {
      // The live transcript vanished: Esc after speaking (or Claude Code sent it, which
      // its prompt.submit hook would mark by bumping `run` within a moment). A released
      // microphone confirms the cancel at once; otherwise look again, as before.
      if ((await micState($)) === 'off') {
        await $.clock.sleep(MIC_CONFIRM_MS)
        if (run === id && phase === 'recording' && (await $.prompt.read()).text === '') { await restore($); return }
        continue
      }
      if ((await isCancelledNatively($, id)) && phase === 'recording') { await restore($); return }
      continue
    }
    // No word yet: the microphone tells whether Claude Code still listens.
    const mic = await micState($)
    if (run !== id || phase !== 'recording') return
    if (mic === 'on') isMicSeen = true
    else if (mic === 'off' && isMicSeen) { await restore($); return } // Esc before the first word
    if ((await $.clock.now()) - since > NO_SPEECH_MS && run === id && phase === 'recording') { await restore($); return }
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
  phase = 'recording'
  $.ui.invalidate('ui.render')
  const ticking = tick($, ++tickRun)
  detach($, ticking)
  const id = ++run
  base = (await $.prompt.read()).text
  // Claude Code's tap mode only starts on an empty prompt; the draft comes back on send or ×.
  if (base !== '' && !(await $.prompt.fill({ text: '' })).isFilled) {
    await fail($, 'the prompt is busy')
    return
  }
  // A non-empty draft just changed already. The prompt must be empty again: tap mode
  // starts only on an empty prompt.
  if (base === '' && !(await releaseKeyboard($)) && (await $.prompt.read()).text !== '') {
    await fail($, 'the prompt is busy')
    return
  }
  if (!(await press($, 'f11'))) {
    await fail($, 'could not reach Claude Code voice; run /dictate setup')
    return
  }
  const watching = watchRecording($, id)
  detach($, watching)
}

async function stop($: EngineInterface) {
  if (phase !== 'recording') return
  phase = 'transcribing'
  $.ui.invalidate('ui.render')
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
    await restore($)
    return
  }
  if (!(await press($, 'f11'))) {
    await press($, 'escape')
    await fail($, 'could not stop the recording')
    return
  }
  const startedWaiting = await $.clock.now()
  let last = ''
  let same = 0
  while ((await $.clock.now()) < startedWaiting + GIVE_UP_MS) {
    await $.clock.sleep(POLL_MS)
    if (run !== id) return // Claude Code sent it: the prompt.submit hook merged it
    const { text } = await $.prompt.read()
    if (run !== id) return
    if (text === '' && last !== '' && (await isCancelledNatively($, id))) { await restore($); return } // Esc while transcribing
    if (run !== id) return
    same = text === last ? same + 1 : 0
    last = text
    if (text.trim() !== '' && same >= SETTLE_POLLS) return finish($, id, text)
  }
  if (run !== id) return
  if (last.trim() !== '') return finish($, id, last)
  await restore($)
  return
}

async function cancel($: EngineInterface) {
  if (phase !== 'recording' && phase !== 'transcribing') return
  run++
  phase = 'idle'
  $.ui.invalidate('ui.render')
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

// `/dictate setup` and `/dictate remove`: the installer's own scripts, for a plugin
// installed without them (the Claude plugin directory). The plugin itself stays put.
// PowerShell 7 by its install path, never a bare `pwsh` a project folder could shadow.
let isConfiguring = false
async function configure($: EngineInterface, arg: 'setup' | 'remove') {
  if (isConfiguring || phase !== 'idle') {
    $.ui.toast(`DictateCLI: ${isConfiguring ? 'already running' : 'finish or cancel the dictation first'}`)
    return
  }
  isConfiguring = true
  const pwsh = `${(await $.env.get('ProgramFiles')) ?? 'C:/Program Files'}/PowerShell/7/pwsh.exe`
  const script = `${$.plugin.root}/scripts/${arg === 'setup' ? 'install' : 'uninstall'}.ps1`
  $.ui.toast(arg === 'setup' ? 'DictateCLI: setting up…' : 'DictateCLI: restoring settings…')
  try {
    const r = await $.process.run([pwsh, '-NoProfile', '-File', script, '-SkipPlugin'], { timeoutMs: 180000 })
    // The scripts end with one line saying how it went, or the reasons it did not.
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.startsWith('Backup:'))
    $.ui.toast(r.exitCode === 0 ? `DictateCLI: ${lines.at(-1) ?? 'done'}` : `DictateCLI ${arg} failed: ${lines.join(' ') || `exit ${r.exitCode}`}`)
  } catch (error) {
    $.ui.toast(`DictateCLI ${arg} could not run PowerShell 7 (${pwsh}): ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isConfiguring = false
  }
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
  on('command.run', { command: COMMAND }, async ($, e) => {
    // `/dictate settings`: the only place DictateCLI explains itself at length.
    if ((e.args ?? '').trim().toLowerCase() === 'settings') {
      await $.ui.open({ id: SETTINGS_PANE, title: 'DictateCLI', focus: true, closeOnEscape: true })
      return {}
    }
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'setup' || arg === 'remove') {
      const configuring = configure($, arg)
      detach($, configuring)
      return {}
    }
    if (arg !== '') {
      $.ui.toast(`DictateCLI: unknown option "${arg}". Use /dictate, or /dictate settings, setup or remove.`)
      return {}
    }
    const now = await $.clock.now()
    const isRepeat = now - lastKeyAt < KEY_QUIET_MS
    lastKeyAt = now
    if (isRepeat) return {}
    const toggling = toggle($) // not awaited: a stop waits for the transcript
    detach($, toggling)
    return {}
  })

  // Claude Code sends a tap-mode transcript of 3+ words itself; the draft comes back after.
  on('prompt.submit', async ($, e, next) => {
    const isOurs = phase === 'recording' || phase === 'transcribing'
    if (!isOurs || e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    run++
    phase = 'idle'
    $.ui.invalidate('ui.render')
    const sent = await next(e) // what was said, alone
    const givingBack = giveDraftBack($)
    detach($, givingBack)
    return sent
  })

  // Typing while Claude Code transcribes: the person takes over. Stop auto-sending
  // and put the draft back in front of what is there.
  on('prompt.edit', async ($, e, next) => {
    if (phase !== 'transcribing' || e.key === undefined) return next(e)
    run++
    phase = 'idle'
    $.ui.invalidate('ui.render')
    const edited = await next(e)
    const gap = base === '' || edited.text === '' || /\s$/.test(base) ? '' : ' '
    const prefix = base + gap
    return { ...edited, text: prefix + edited.text, cursor: prefix.length + edited.cursor }
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { language } = (await $.settings.read()) as { language?: unknown }
    const key = shortcut === undefined ? 'none bound' : chordLabel(shortcut)
    const voice = typeof language === 'string' && language !== '' ? language : 'Claude Code default (English)'
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>DictateCLI</Text>
        <Text dimColor>Voice dictation for Claude Code, on its native voice.</Text>
        <Text> </Text>
        <Text>{`Start / send   click the mic, or ${key} (also /dictate)`}</Text>
        <Text>Cancel         Esc, or Cancel on the card</Text>
        <Text>{`Language       ${voice}`}</Text>
        <Text dimColor>               follows Claude Code's `language` setting (/config); it also sets the language Claude answers in</Text>
        <Text dimColor>Options        /plugin → dictate-cli → configure (icon, beside)</Text>
        <Text dimColor>Setup          /dictate setup after installing from the plugin directory; /dictate remove undoes it</Text>
        <Text> </Text>
        <Text dimColor>Esc closes this panel.</Text>
      </Box>
    )
  })

  // A bordered card at the right of the band right above the prompt (no site draws
  // inside the prompt row). Whatever other plugins
  // draw in the band stays, to the left.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isWorking = e.props.isWorking
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const icon = ICONS[options.icon === 'emoji' ? 'emoji' : 'nerd']
    const others = await next(e)
    const onToggle = () => detach($, toggle($))
    const key = shortcut === undefined ? '' : ` or ${chordLabel(shortcut)}`
    const cardWidth = (options.icon === 'emoji' ? 2 : 1) + 4 // glyph + padding + border

    const card = (
      <Box
        flexDirection="row"
        flexShrink={0}
        borderStyle="round"
        borderColor={phase === 'recording' || phase === 'error' ? 'red' : undefined}
        borderDimColor={phase === 'idle'}
        paddingX={1}
      >
        {phase === 'idle' && <Button key="mic" label={icon.mic} plain onPress={onToggle} />}
        {phase === 'recording' && <Text color="red">● {elapsed(Date.now())}   </Text>}
        {phase === 'recording' && <Button key="cancel" label={`${icon.cancel} Cancel`} plain dimColor onPress={() => detach($, cancel($))} />}
        {phase === 'recording' && <Text>   </Text>}
        {phase === 'recording' && <Button key="mic" label={`${icon.mic}  Send`} plain onPress={onToggle} />}
        {phase === 'transcribing' && <Text dimColor>Transcribing…  </Text>}
        {phase === 'transcribing' && <Button key="cancel" label={icon.cancel} plain dimColor onPress={() => detach($, cancel($))} />}
        {phase === 'error' && <Text color="red">{message}   </Text>}
        {phase === 'error' && <Button key="mic" label={icon.mic} plain onPress={onToggle} />}
      </Box>
    )

    // Idle shows the mic alone; name, shortcut and help appear while the pointer is on
    // it (a hover reveal, painted to its left over the band's empty space).
    const control = phase !== 'idle' ? card : (
      <Box key="dictate-cli" flexDirection="row" flexShrink={0}>
        <Box
          position="absolute"
          top={0}
          right={cardWidth + 1}
          flexDirection="column"
          alignItems="flex-end"
          display="none"
          hover={{ display: 'flex' }}
        >
          <Text bold>DictateCLI</Text>
          <Text dimColor>{`Click${key} to dictate · Esc cancels`}</Text>
          <Text dimColor>/dictate settings</Text>
        </Box>
        {card}
      </Box>
    )

    // Another plugin's tree beneath us in the band: one row, its card then ours.
    const isBottom = others === null || others === undefined || (others as { type?: unknown }).type === 'engine'
    if (!isBottom) {
      return (
        <Box flexDirection="row" alignItems="flex-end">
          {others}
          <Box flexGrow={1} />
          {control}
        </Box>
      )
    }
    // We are the bottom of the chain. With `beside`, a plugin drawn above us in the
    // band shares our rows instead of stacking under the card: the card's
    // own Box pulls the next sibling up (a Box clips what overflows it, so the margin
    // sits on the outermost Box). The engine's node is left out there: under a Box
    // with a margin it is refused, and with no survey (checked above) it draws nothing.
    if (options.beside === true) {
      return (
        <Box flexDirection="row" justifyContent="flex-end" marginBottom={-3}>
          {control}
        </Box>
      )
    }
    // No width or margin on any Box around `others`: the engine refuses its node there.
    return (
      <Box flexDirection="column">
        {others}
        <Box flexDirection="row" justifyContent="flex-end">
          {control}
        </Box>
      </Box>
    )
  })
}
