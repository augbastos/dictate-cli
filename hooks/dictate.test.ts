import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { merge } from './merge'
import { COMMAND, KEY_QUIET_MS, TRANSPORT_KEYS } from './register'
import { shortcutOf } from './shortcut'

// A stand-in for Claude Code beneath the mod: the prompt box, the voice keybinding
// in tap mode on F11 (starts on an empty box, stops, Esc cancels and empties the box),
// the live transcript while recording, and what got sent.
type Native = { transcript: string; interim?: string; helperFails?: boolean; transcribeMs?: number }

function fakeClaude($: Engine, on: On, native: Native, draft = '') {
  const clock = mock.clock(on)
  const state = {
    box: draft,
    isRecording: false,
    isProcessing: false,
    keys: [] as string[],
    sent: [] as string[],
    commandRuns: 0,
  }

  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
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
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('command.run', () => {
    state.commandRuns++
    return {}
  })
  const esc = () => {
    // Claude Code's own cancel: drop the audio and the transcript, back to the anchor.
    if (!state.isRecording && !state.isProcessing) return
    state.isRecording = false
    state.isProcessing = false
    state.box = ''
  }
  on('process.run', (_, e) => {
    const key = e.argv[1]
    state.keys.push(key)
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (native.helperFails) return { value: { ...ok, exitCode: 2 } }
    if (key === 'escape') esc()
    else if (key !== 'f11') return { value: { ...ok, exitCode: 64 } } // the helper refuses anything else
    else if (!state.isRecording) {
      if (state.box !== '') return { value: ok } // tap mode starts only on an empty prompt
      state.isRecording = true
      if (native.interim !== undefined) {
        void (async () => {
          await clock.sleep(300)
          if (state.isRecording) state.box = native.interim ?? ''
        })()
      }
    } else {
      state.isRecording = false
      state.isProcessing = true
      void (async () => {
        await clock.sleep(native.transcribeMs ?? 600) // transcription
        if (!state.isProcessing) return // cancelled meanwhile
        state.isProcessing = false
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
  return { clock, state, esc }
}

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { bodyRows: 9, top: 0 },
  view: {},
}

async function mountBand($: Engine) {
  return $.ui.mount({ plugin: 'dictate', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
}

type Ui = Awaited<ReturnType<typeof mountBand>>
type Clock = ReturnType<typeof mock.clock>

const runCommand = ($: Engine) =>
  $.command.run({ command: COMMAND, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)

// The two inputs. Keyboard: the shortcut key runs /dictate (its keybinding is
// `command:dictate`); presses are spaced past the repeat window, as a person's are.
function inputs($: Engine, ui: Ui, clock: Clock) {
  const key = async () => {
    await clock.advance(KEY_QUIET_MS + 1)
    await runCommand($)
    await clock.settle()
  }
  const click = async () => {
    await ui.press({ key: 'mic' })
  }
  return { key, click }
}

for (const via of ['mouse', 'keyboard'] as const) {
  describe(`dictate via ${via}`, () => {
    const setup = async ($: Engine, on: On, native: Native, draft = '') => {
      const fake = fakeClaude($, on, native, draft)
      const ui = await mountBand($)
      const { key, click } = inputs($, ui, fake.clock)
      return { ...fake, ui, toggle: via === 'mouse' ? click : key }
    }

    test('idle → record: starts Claude Code voice, the card shows it', async ($, on) => {
      const { state, ui, toggle } = await setup($, on, { transcript: '' })
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
      await toggle()
      expect(state.keys).toEqual(['f11'])
      expect(state.isRecording).toBe(true)
      expect(await ui.find({ key: 'cancel' })).toBeDefined()
      expect(await ui.find({ text: /● 0:0/ })).toBeDefined()
      expect(await ui.find({ text: /Send/ })).toBeDefined()
    })

    test('record → stop → one submit (PT-BR)', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: 'compara também com a versão anterior' })
      await toggle()
      await toggle()
      expect(await ui.find({ text: 'Transcribing' })).toBeDefined()
      await clock.advance(5000)
      expect(state.keys).toEqual(['f11', 'f11'])
      expect(state.sent).toEqual(['compara também com a versão anterior'])
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('typed + voice: one prompt with both (English)', async ($, on) => {
      const { clock, state, toggle } = await setup($, on, { transcript: 'compare it with the previous behaviour' }, 'check this test and')
      await toggle()
      expect(state.box).toBe('')
      await toggle()
      await clock.advance(5000)
      expect(state.sent).toEqual(['check this test and compare it with the previous behaviour'])
    })

    test('code-switching PT-BR + English term', async ($, on) => {
      const { clock, state, toggle } = await setup($, on, { transcript: 'faz o rollback do deploy no staging' }, 'por favor')
      await toggle()
      await toggle()
      await clock.advance(5000)
      expect(state.sent).toEqual(['por favor faz o rollback do deploy no staging'])
    })

    test('× cancels: nothing sent, draft restored, idle again', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: 'should never be sent' }, 'investiga isso e')
      await toggle()
      const cancelling = ui.press({ key: 'cancel' })
      await clock.advance(1000)
      await cancelling
      await clock.advance(5000)
      expect(state.keys).toEqual(['f11', 'escape'])
      expect(state.sent).toEqual([])
      expect(state.box).toBe('investiga isso e')
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('Esc (Claude Code cancel) after speaking: draft restored, nothing sent, card idle', async ($, on) => {
      const { clock, state, ui, toggle, esc } = await setup($, on, { transcript: 'never sent', interim: 'never' }, 'meu rascunho')
      await toggle()
      await clock.advance(1000) // the live transcript shows
      expect(state.box).toBe('never')
      esc() // the person presses Esc: Claude Code handles it
      await clock.advance(2000)
      expect(state.sent).toEqual([])
      expect(state.box).toBe('meu rascunho')
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('Esc while transcribing: draft restored, nothing sent', async ($, on) => {
      const { clock, state, ui, toggle, esc } = await setup($, on, { transcript: 'never sent at all', interim: 'never sent' }, 'rascunho')
      await toggle()
      await clock.advance(1000)
      await toggle()
      esc()
      await clock.advance(15000)
      expect(state.sent).toEqual([])
      expect(state.box).toBe('rascunho')
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('short transcript (under 3 words) is sent once it settles', async ($, on) => {
      const { clock, state, toggle } = await setup($, on, { transcript: 'sim' }, 'roda os testes?')
      await toggle()
      await toggle()
      await clock.advance(15000)
      expect(state.sent).toEqual(['roda os testes? sim'])
      expect(state.box).toBe('')
    })

    test('silence: nothing sent, draft restored, Esc makes sure nothing listens', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: '' }, 'linha 1\nlinha 2 ')
      await toggle()
      await toggle()
      await clock.advance(15000)
      expect(state.sent).toEqual([])
      expect(state.box).toBe('linha 1\nlinha 2 ')
      expect(state.keys).toEqual(['f11', 'f11', 'escape'])
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('helper failure (STT unreachable) keeps the draft, sends nothing, recovers', async ($, on) => {
      const native: Native = { transcript: 'a b c', helperFails: true }
      const { clock, state, ui, toggle } = await setup($, on, native, 'texto digitado')
      await toggle()
      expect(state.box).toBe('texto digitado')
      expect(state.sent).toEqual([])
      expect(await ui.find({ text: /could not reach/ })).toBeDefined()
      await clock.advance(3000)
      expect(await ui.find({ text: /could not reach/ })).toBeUndefined()
      native.helperFails = false
      await toggle()
      expect(state.isRecording).toBe(true)
    })

    test('a press while transcribing does nothing', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: 'one two three four', transcribeMs: 3000 })
      await toggle()
      await toggle()
      if (via === 'keyboard') await toggle()
      else expect(await ui.find({ key: 'mic' })).toBeUndefined() // no mic to click while transcribing
      await clock.advance(15000)
      expect(state.keys).toEqual(['f11', 'f11'])
      expect(state.sent).toEqual(['one two three four'])
    })

    test('five cycles in a row leave no state behind', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: 'ciclo de teste repetido' })
      for (let i = 0; i < 5; i++) {
        await toggle()
        await toggle()
        await clock.advance(5000)
      }
      expect(state.sent).toHaveLength(5)
      expect(state.keys).toHaveLength(10)
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })

    test('typing while it transcribes stops auto-send and keeps the draft in front', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: '' }, 'base')
      await toggle()
      await toggle()
      const typed = await $.prompt.edit({
        origin: { kind: 'composer' }, key: { key: 'x' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'x',
      })
      expect(typed.text).toBe('base x')
      await clock.advance(15000)
      expect(state.sent).toEqual([])
      expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    })
  })
}

describe('keyboard specifics', () => {
  test('rapid double tap: one transition', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' })
    await mountBand($)
    await clock.advance(KEY_QUIET_MS + 1)
    await runCommand($)
    await clock.advance(200)
    await runCommand($)
    await clock.settle()
    expect(state.keys).toEqual(['f11'])
    expect(state.isRecording).toBe(true)
  })

  test('held key (repeats every 33 ms for 2 s): one transition, no start/stop oscillation', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' })
    await mountBand($)
    await clock.advance(KEY_QUIET_MS + 1)
    await runCommand($)
    await clock.advance(500) // Windows' default delay before repeating
    for (let i = 0; i < 45; i++) {
      await runCommand($)
      await clock.advance(33)
    }
    await clock.settle()
    expect(state.keys).toEqual(['f11'])
    expect(state.isRecording).toBe(true)
  })

  test('mouse start + keyboard stop, keyboard start + mouse stop', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'misturando mouse e teclado' })
    const ui = await mountBand($)
    const { key, click } = inputs($, ui, clock)
    await click()
    await key()
    await clock.advance(5000)
    await key()
    await click()
    await clock.advance(5000)
    expect(state.sent).toEqual(['misturando mouse e teclado', 'misturando mouse e teclado'])
    expect(state.keys).toEqual(['f11', 'f11', 'f11', 'f11'])
  })

  test('keyboard start + × cancel, mouse start + Esc', async ($, on) => {
    const { clock, state, esc } = fakeClaude($, on, { transcript: 'nunca', interim: 'nunca' }, 'rascunho')
    const ui = await mountBand($)
    const { key, click } = inputs($, ui, clock)
    await key()
    const cancelling = ui.press({ key: 'cancel' })
    await clock.advance(1000)
    await cancelling
    expect(state.box).toBe('rascunho')
    await click()
    await clock.advance(1000)
    esc()
    await clock.advance(2000)
    expect(state.box).toBe('rascunho')
    expect(state.sent).toEqual([])
  })

  test('no recursion: Dictate never presses its own shortcut, one /dictate run per press', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'uma frase de teste' })
    const ui = await mountBand($)
    const { key } = inputs($, ui, clock)
    await key()
    await key()
    await clock.advance(5000)
    expect(TRANSPORT_KEYS).not.toContain('f9')
    expect(state.keys.every(k => (TRANSPORT_KEYS as readonly string[]).includes(k))).toBe(true)
    expect(state.commandRuns).toBe(0) // the mod answers /dictate itself; nothing re-runs it
    expect(state.sent).toEqual(['uma frase de teste'])
  })

  test('a prompt typed without Dictate passes untouched; a slash command while recording is not merged', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' }, 'rascunho')
    const ui = await mountBand($)
    await $.prompt.submit({ text: 'normal prompt', origin: { kind: 'composer' } })
    await inputs($, ui, clock).click()
    await $.prompt.submit({ text: '/dictate', origin: { kind: 'composer' } })
    expect(state.sent).toEqual(['normal prompt', '/dictate'])
  })

  test('the card shows the chord bound to /dictate', async ($, on) => {
    fakeClaude($, on, { transcript: '' })
    mock.env(on, { USERPROFILE: 'C:/Users/someone' })
    on('fs.read', () => ({ value: JSON.stringify({ bindings: [{ context: 'Chat', bindings: { f9: 'command:dictate', f11: 'voice:pushToTalk' } }] }) }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
    const ui = await mountBand($)
    expect(await ui.find({ text: 'F9' })).toBeDefined()
  })
})

describe('config', () => {
  test('default shortcut: install binds F9 to command:dictate, F11 is the transport', () => {
    const installed = { bindings: [{ context: 'Chat', bindings: { f9: 'command:dictate', f11: 'voice:pushToTalk', space: null } }] }
    expect(shortcutOf(JSON.stringify(installed))).toBe('f9')
  })
  test('no shortcut bound, or another context: none shown', () => {
    expect(shortcutOf(JSON.stringify({ bindings: [] }))).toBeUndefined()
    expect(shortcutOf(JSON.stringify({ bindings: [{ context: 'Global', bindings: { f9: 'command:dictate' } }] }))).toBeUndefined()
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
