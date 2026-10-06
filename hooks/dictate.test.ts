import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { merge } from './merge'
import { COMMAND, KEY_QUIET_MS, NO_SPEECH_MS, TRANSPORT_KEYS } from './register'
import { shortcutOf } from './shortcut'

// A stand-in for Claude Code beneath the mod: the prompt box, the voice keybinding
// in tap mode on F11 (starts on an empty box, stops, Esc cancels and empties the box),
// the live transcript while recording, and what got sent.
type Native = { transcript: string; interim?: string; helperFails?: boolean; transcribeMs?: number; micUnknown?: boolean }

function fakeClaude($: Engine, on: On, native: Native, draft = '') {
  const clock = mock.clock(on)
  const state = {
    box: draft,
    isRecording: false,
    isProcessing: false,
    keys: [] as string[],
    sent: [] as string[],
    commandRuns: 0,
    log: [] as string[], // fills and keys, in order
  }

  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
  on('prompt.read', () => ({ value: { text: state.box, cursor: state.box.length } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    state.log.push(`fill:${JSON.stringify(e.text)}`)
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
    if (key !== 'mic') {
      state.keys.push(key)
      state.log.push(`key:${key}`)
    }
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (native.helperFails) return { value: { ...ok, exitCode: 2 } }
    if (key === 'mic') return { value: { ...ok, exitCode: native.micUnknown ? 12 : state.isRecording ? 10 : 11 } }
    if (key === 'escape') esc()
    else if (key !== 'f11') return { value: { ...ok, exitCode: 64 } } // the helper refuses anything else
    else if (!state.isRecording) {
      if (state.box !== '') return { value: ok } // tap mode starts only on an empty prompt
      state.isRecording = true
      // The live transcript shows in the prompt while recording (none when silent).
      const interim = native.interim ?? native.transcript
      if (interim !== '') {
        void (async () => {
          await clock.sleep(300)
          if (state.isRecording) state.box = interim
        })()
      }
    } else {
      state.isRecording = false
      state.isProcessing = true
      const shown = state.box
      void (async () => {
        await clock.sleep(native.transcribeMs ?? 600) // transcription
        if (!state.isProcessing) return // cancelled meanwhile
        state.isProcessing = false
        // Claude Code drops the final insert (and its send) when the prompt changed
        // since its live transcript ("input_diverged").
        if (state.box !== shown) return
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
  return $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
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
  describe(`DictateCLI via ${via}`, () => {
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

    test('typed draft + voice: the voice is sent alone, the draft comes back (English)', async ($, on) => {
      const { clock, state, toggle } = await setup($, on, { transcript: 'compare it with the previous behaviour' }, 'check this test and')
      await toggle()
      expect(state.box).toBe('')
      await toggle()
      await clock.advance(5000)
      expect(state.sent).toEqual(['compare it with the previous behaviour'])
      expect(state.box).toBe('check this test and')
    })

    test('code-switching PT-BR + English term', async ($, on) => {
      const { clock, state, toggle } = await setup($, on, { transcript: 'faz o rollback do deploy no staging' }, 'por favor')
      await toggle()
      await toggle()
      await clock.advance(5000)
      expect(state.sent).toEqual(['faz o rollback do deploy no staging'])
      expect(state.box).toBe('por favor')
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
      expect(state.sent).toEqual(['sim'])
      expect(state.box).toBe('roda os testes?')
    })

    test('silence: nothing sent, draft restored, Esc makes sure nothing listens', async ($, on) => {
      const { clock, state, ui, toggle } = await setup($, on, { transcript: '' }, 'linha 1\nlinha 2 ')
      await toggle()
      await toggle()
      await clock.advance(15000)
      expect(state.sent).toEqual([])
      expect(state.box).toBe('linha 1\nlinha 2 ')
      expect(state.keys).toEqual(['f11', 'escape']) // never F11 blind: Esc, then the draft
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
      const { clock, state, ui, toggle } = await setup($, on, { transcript: 'algo dito aqui', transcribeMs: 5000 }, 'base')
      await toggle()
      await toggle()
      const typed = await $.prompt.edit({
        origin: { kind: 'composer' }, key: { key: 'x' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'x',
      })
      expect(typed.text).toBe('base x')
      state.box = typed.text // the box shows what the edit chain answered
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

  test('while a turn runs, × before any words presses no Esc (it would interrupt the turn)', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: '' }, 'rascunho')
    const ui = await $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, isWorking: true } as never })
    await ui.press({ key: 'mic' })
    const cancelling = ui.press({ key: 'cancel' })
    await clock.advance(1000)
    await cancelling
    expect(state.keys).toEqual(['f11'])
    expect(state.box).toBe('rascunho')
    expect(state.sent).toEqual([])
  })

  test('no recursion: DictateCLI never presses its own shortcut, one /dictate run per press', async ($, on) => {
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

  test('a prompt typed without DictateCLI passes untouched; a slash command while recording is not merged', async ($, on) => {
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
    on('fs.read', () => ({ value: JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'alt+d': 'command:dictate', f11: 'voice:pushToTalk' } }] }) }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
    const ui = await mountBand($)
    expect(await ui.find({ text: 'ALT+D' })).toBeDefined()
  })
})

describe('Esc before the first word', () => {
  test('the mic is released: the card goes idle at once and the draft comes back', async ($, on) => {
    const { clock, state, esc } = fakeClaude($, on, { transcript: '' }, 'meu rascunho')
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    await clock.advance(600) // the mic is seen in use
    esc()
    await clock.advance(600)
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    expect(state.box).toBe('meu rascunho')
    expect(state.sent).toEqual([])
    expect(state.keys).toEqual(['f11'])
  })

  test('Esc after speaking: the released mic closes the card in well under a second', async ($, on) => {
    const { clock, state, esc } = fakeClaude($, on, { transcript: 'never', interim: 'never' }, 'rascunho')
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    await clock.advance(1000)
    esc()
    await clock.advance(700)
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    expect(state.box).toBe('rascunho')
    expect(state.sent).toEqual([])
  })

  test('mic state unknown: the card goes idle once the voice has surely stopped (16 s)', async ($, on) => {
    const { clock, state, esc } = fakeClaude($, on, { transcript: '', micUnknown: true }, 'meu rascunho')
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    esc()
    await clock.advance(NO_SPEECH_MS - 2000)
    expect(await ui.find({ key: 'cancel' })).toBeDefined() // still unknown: Claude Code may be listening to silence
    await clock.advance(3000)
    expect(await ui.find({ key: 'cancel' })).toBeUndefined()
    expect(state.box).toBe('meu rascunho')
    expect(state.sent).toEqual([])
    expect(state.keys).toEqual(['f11']) // nothing pressed blind
  })
})

describe('focus after a click', () => {
  test('start by click on an empty prompt: the prompt text changes and comes back before F11 (the band lets go)', async ($, on) => {
    const { state } = fakeClaude($, on, { transcript: '' })
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    expect(state.log).toEqual(['fill:" "', 'fill:""', 'key:f11'])
    expect(state.box).toBe('')
  })

  test('start by click with a draft: emptying the prompt is the change', async ($, on) => {
    const { state } = fakeClaude($, on, { transcript: '' }, 'rascunho')
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    expect(state.log).toEqual(['fill:""', 'key:f11'])
  })

  test('Cancel click: keyboard released before Esc goes to the voice', async ($, on) => {
    const { clock, state } = fakeClaude($, on, { transcript: 'nunca', interim: 'nunca' }, 'rascunho')
    const ui = await mountBand($)
    await ui.press({ key: 'mic' })
    await clock.advance(1000)
    state.log.length = 0
    const cancelling = ui.press({ key: 'cancel' })
    await clock.advance(1000)
    await cancelling
    expect(state.log.slice(0, 3)).toEqual(['fill:"nunca "', 'fill:"nunca"', 'key:escape'])
    expect(state.box).toBe('rascunho')
    expect(state.sent).toEqual([])
  })
})

describe('config', () => {
  test('default install: no shortcut bound (no key hint on the card), F11 is the transport', () => {
    const installed = { bindings: [{ context: 'Chat', bindings: { f11: 'voice:pushToTalk', space: null } }] }
    expect(shortcutOf(JSON.stringify(installed))).toBeUndefined()
  })
  test('a chord bound to command:dictate is the shortcut shown', () => {
    const bound = { bindings: [{ context: 'Chat', bindings: { 'alt+d': 'command:dictate', f11: 'voice:pushToTalk' } }] }
    expect(shortcutOf(JSON.stringify(bound))).toBe('alt+d')
  })
  test('identity: the command stays /dictate, the transport never includes a user key', () => {
    expect(COMMAND).toBe('dictate')
    expect([...TRANSPORT_KEYS]).toEqual(['f11', 'escape'])
  })
  test('no shortcut bound, or another context: none shown', () => {
    expect(shortcutOf(JSON.stringify({ bindings: [] }))).toBeUndefined()
    expect(shortcutOf(JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'alt+d': 'command:dictate' } }] }))).toBeUndefined()
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
