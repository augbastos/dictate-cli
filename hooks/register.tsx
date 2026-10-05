import type { EngineInterface, Register } from 'claude-code'

import { merge } from './merge'

// Dictate draws a mic on the hint line under the prompt and drives Claude Code's
// own voice dictation (`/voice`, tap mode) by pressing its keybinding (F9) for you.
// The speech-to-text is Claude Code's; this mod adds the buttons, keeps what you
// had typed, and sends.

type Phase = 'idle' | 'recording' | 'transcribing' | 'error'
type Key = 'f9' | 'escape'

const POLL_MS = 250
// Under 3 words Claude Code inserts the transcript without sending it: once the
// draft has stood still this long after stop, Dictate sends it.
const SETTLE_POLLS = 6
const GIVE_UP_MS = 12_000
const KEY_GAP_MS = 150
const ERROR_MS = 2500

// ponytail: module state is lost on a hot reload mid-recording; × or the next
// click recovers. Move it to $.state if that ever matters.
let phase: Phase = 'idle'
let base = ''
let run = 0 // bumped on every start, cancel and finish, so a stale poll stops
let message = ''
let isWorking = false // a turn is running: Esc would interrupt it

function show($: EngineInterface, next: Phase) {
  phase = next
  $.ui.invalidate('ui.render')
}

async function press($: EngineInterface, key: Key) {
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

async function start($: EngineInterface) {
  if (phase === 'recording' || phase === 'transcribing') return
  show($, 'recording')
  run++
  base = (await $.prompt.read()).text
  // Claude Code's tap mode only starts on an empty prompt; the draft comes back on send or ×.
  if (base !== '' && !(await $.prompt.fill({ text: '' })).isFilled) {
    return fail($, 'the prompt is busy')
  }
  if (!(await press($, 'f9'))) {
    return fail($, 'could not reach Claude Code voice; run scripts/install.ps1')
  }
}

async function stop($: EngineInterface) {
  if (phase !== 'recording') return
  show($, 'transcribing')
  const id = run
  if (!(await press($, 'f9'))) {
    await press($, 'escape')
    return fail($, 'could not stop the recording')
  }
  let last = ''
  let same = 0
  const end = (await $.clock.now()) + GIVE_UP_MS
  while ((await $.clock.now()) < end) {
    await $.clock.sleep(POLL_MS)
    if (run !== id) return // Claude Code sent it: the prompt.submit hook merged it
    const { text } = await $.prompt.read()
    if (run !== id) return
    same = text === last ? same + 1 : 0
    last = text
    if (text.trim() !== '' && same >= SETTLE_POLLS) return finish($, id, text)
  }
  if (run !== id) return
  if (last.trim() !== '') return finish($, id, last)
  // Nothing heard: make sure nothing is still listening, give the draft back.
  run++
  if (!isWorking) await press($, 'escape')
  await $.prompt.fill({ text: base })
  show($, 'idle')
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

export const register: Register = on => {
  // Claude Code sends a tap-mode transcript of 3+ words itself: put the draft in front.
  on('prompt.submit', async ($, e, next) => {
    const isOurs = phase === 'recording' || phase === 'transcribing'
    if (!isOurs || e.origin.kind !== 'composer') return next(e)
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

  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    isWorking = e.props.isWorking
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const isLive = phase === 'recording' || phase === 'transcribing'

    return (
      <Box flexDirection="row" width="100%">
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {e.props.hint}
          </Text>
        </Box>
        {phase === 'recording' && <Text color="red">● REC </Text>}
        {phase === 'transcribing' && <Text dimColor>transcribing… </Text>}
        {phase === 'error' && <Text color="red">{message} </Text>}
        {isLive && <Button key="cancel" label="×" plain onPress={() => void cancel($)} />}
        {isLive && <Text> </Text>}
        <Button
          key="mic"
          label="🎤"
          plain
          dimColor={!isLive}
          onPress={() => void (phase === 'recording' ? stop($) : start($))}
        />
      </Box>
    )
  })
}
