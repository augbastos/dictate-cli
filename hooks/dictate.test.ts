import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { merge } from './merge'

// A stand-in for Claude Code beneath the mod: the prompt box, the voice
// keybinding in tap mode (F9 starts on an empty box, F9 stops, Esc cancels),
// and what got sent.
type Native = { transcript: string; helperFails?: boolean }

function fakeClaude($: Engine, on: On, native: Native, draft = '') {
  const clock = mock.clock(on)
  const state = { box: draft, isRecording: false, keys: [] as string[], sent: [] as string[] }

  on('prompt.read', () => ({ value: { text: state.box, cursor: state.box.length } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    state.box = e.mode === 'append' ? state.box + e.text : e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    state.sent.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    const key = e.argv[1]
    state.keys.push(key)
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (native.helperFails) return { value: { ...ok, exitCode: 2 } }
    if (key === 'escape') {
      state.isRecording = false
      state.box = ''
    } else if (!state.isRecording) {
      state.isRecording = state.box === ''
    } else {
      state.isRecording = false
      void (async () => {
        await clock.sleep(600) // transcription
        const words = native.transcript.trim().split(/\s+/).filter(Boolean).length
        if (words >= 3) {
          state.box = ''
          await $.prompt.submit({ text: native.transcript, origin: { kind: 'composer' } })
        } else {
          state.box = native.transcript
        }
      })()
    }
    return { value: ok }
  })
  return { clock, state }
}

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

async function mountHint($: Engine) {
  return $.ui.mount({ plugin: 'dictate', surface: 'terminal', component: 'PromptHint', props: HINT })
}

describe('dictate', () => {
  test('idle → record: the mic starts Claude Code voice', async ($, on) => {
    const { state } = fakeClaude($, on, { transcript: '' })
    const ui = await mountHint($)
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    await ui.press({ key: 'mic' })
    expect(state.keys).toEqual(['f9'])
    expect(state.isRecording).toBe(true)
    expect(await ui.find({ key: 'cancel' })).toBeDefined()
    expect(await ui.find({ text: 'REC' })).toBeDefined()
  })

  test('record → × cancels: nothing sent, typed text restored, idle again', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'should never be sent' }, 'investiga isso e')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    expect(state.box).toBe('')
    const cancelling = ui.press({ key: 'cancel' })
    await clock.advance(1000)
    await cancelling
    await clock.advance(5000)
    expect(state.keys).toEqual(['f9', 'escape'])
    expect(state.sent).toEqual([])
    expect(state.box).toBe('investiga isso e')
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
  })

  test('record → stop → transcript of 3+ words is sent once (pure voice, PT-BR)', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'compara também com a versão anterior' })
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    expect(await ui.find({ text: 'transcribing' })).toBeDefined()
    await clock.advance(5000)
    expect(state.keys).toEqual(['f9', 'f9'])
    expect(state.sent).toEqual(['compara também com a versão anterior'])
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
  })

  test('typed + voice: one prompt with both, English', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'compare it with the previous behaviour' }, 'check this test and')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    await clock.advance(5000)
    expect(state.sent).toEqual(['check this test and compare it with the previous behaviour'])
  })

  test('short transcript (under 3 words) is sent by Dictate once it settles', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'sim' }, 'roda os testes?')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    await clock.advance(15000)
    expect(state.sent).toEqual(['roda os testes? sim'])
    expect(state.box).toBe('')
  })

  test('silence: nothing sent, draft restored, Esc makes sure nothing listens', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' }, 'linha 1\nlinha 2 ')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    await clock.advance(15000)
    expect(state.sent).toEqual([])
    expect(state.box).toBe('linha 1\nlinha 2 ')
    expect(state.keys).toEqual(['f9', 'f9', 'escape'])
  })

  test('double click does not double-submit', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'one two three four' })
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' }) // lands while transcribing: ignored
    await clock.advance(15000)
    expect(state.keys).toEqual(['f9', 'f9'])
    expect(state.sent).toEqual(['one two three four'])
  })

  test('helper or mic failure keeps the typed text and sends nothing, then recovers', async ($, on) => {
    const native: Native = { transcript: 'a b c', helperFails: true }
    const { clock, state } = fakeClaude($, on, native, 'texto digitado')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    expect(state.box).toBe('texto digitado')
    expect(state.sent).toEqual([])
    expect(await ui.find({ text: /could not reach/ })).toBeDefined()
    await clock.advance(3000)
    expect(await ui.find({ text: /could not reach/ })).toBeUndefined()
    native.helperFails = false
    await ui.press({ key: 'mic' })
    expect(state.isRecording).toBe(true)
  })

  test('mic gives no audio (permission denied): same as silence, composer intact', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '   ' }, 'base')
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    await clock.advance(15000)
    expect(state.sent).toEqual([])
    expect(state.box).toBe('base')
  })

  test('five cycles in a row leave no state behind', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'ciclo de teste repetido' })
    const ui = await mountHint($)
    for (let i = 0; i < 5; i++) {
      await ui.press({ key: 'mic' })
      await ui.press({ key: 'mic' })
      await clock.advance(5000)
    }
    expect(state.sent).toHaveLength(5)
    expect(state.keys).toHaveLength(10)
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
  })

  test('typing while it transcribes stops auto-send and keeps the draft in front', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' }, 'base')
    on('prompt.edit', (_, e) => {
      const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
      return { text, cursor: e.start + e.inputText.length }
    })
    const ui = await mountHint($)
    await ui.press({ key: 'mic' })
    await ui.press({ key: 'mic' })
    const typed = await $.prompt.edit({
      origin: { kind: 'composer' }, key: { key: 'x' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'x',
    })
    expect(typed.text).toBe('base x')
    await clock.advance(15000)
    expect(state.sent).toEqual([])
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
  })

  test('a prompt the person types without Dictate passes untouched', async ($, on) => {
    const { state } = fakeClaude($, on, { transcript: '' })
    await mountHint($)
    await $.prompt.submit({ text: 'normal prompt', origin: { kind: 'composer' } })
    expect(state.sent).toEqual(['normal prompt'])
  })
})

describe('merge', () => {
  test('joins with one space, keeps newlines and trailing space, drops empty', () => {
    expect(merge('', 'oi')).toBe('oi')
    expect(merge('investiga esse erro e', ' compara também ')).toBe('investiga esse erro e compara também')
    expect(merge('a\n', 'b')).toBe('a\nb')
    expect(merge('a ', 'b.')).toBe('a b.')
    expect(merge('   ', 'b')).toBe('b')
    expect(merge('a', '  ')).toBeNull()
  })
})
