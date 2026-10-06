import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COMMAND, chordLabel } from './register'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 9, top: 0 }, view: {} }
const MIC = '\u{F036C}'

// A minimal Claude Code beneath the mod: prompt box, voice on F11 with a live transcript.
function fake($: Engine, on: On) {
  const clock = mock.clock(on)
  const state = { box: '', isRecording: false }
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: state.box, cursor: state.box.length } }))
  on('prompt.fill', (_, e) => {
    state.box = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('process.run', (_, e) => {
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const key = e.argv[1]
    if (key === 'mic') return { value: { ...ok, exitCode: state.isRecording ? 10 : 11 } }
    if (key === 'f11' && !state.isRecording) {
      state.isRecording = true
      void (async () => {
        await clock.sleep(300)
        if (state.isRecording) state.box = 'uma frase longa aqui'
      })()
    } else if (key === 'f11') {
      state.isRecording = false
    }
    return { value: ok }
  })
  return { clock, state }
}

// What a person sees without hovering: Boxes drawn display "none" are skipped.
function visible(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (!n || typeof n !== 'object') return []
  if (n.type === 'Box' && n.props?.display === 'none') return []
  const own = n.type === 'Button' && typeof n.props?.label === 'string' ? [n.props.label as string] : []
  return [...own, ...(n.children ?? []).flatMap(visible)]
}

const mountBand = ($: Engine) =>
  $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })

test('idle: only the mic is visible; name and help wait in a hover tip', async ($, on) => {
  fake($, on)
  const ui = await mountBand($)
  expect(visible(await ui.drawn()).join('')).toBe(MIC)
  expect(await ui.find({ text: 'DictateCLI' })).toBeDefined() // present, hidden until hover
  expect(await ui.find({ text: '/dictate settings' })).toBeDefined()
})

test('recording shows timer, Cancel and Send; transcribing shows one word and a cancel glyph', async ($, on) => {
  const { clock } = fake($, on)
  const ui = await mountBand($)
  await ui.press({ key: 'mic' })
  const recording = visible(await ui.drawn()).join('')
  expect(recording).toMatch(/● 0:0\d/)
  expect(recording).toContain('Cancel')
  expect(recording).toContain('Send')
  await clock.advance(1000)
  await ui.press({ key: 'mic' })
  const transcribing = visible(await ui.drawn()).join('')
  expect(transcribing).toContain('Transcribing…')
  expect(transcribing).not.toContain('Cancel')
  expect(transcribing).not.toContain('DictateCLI')
})

test('/dictate settings opens a pane that follows Claude Code\'s own language setting', async ($, on) => {
  fake($, on)
  const opened: unknown[] = []
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('settings.read', () => ({ value: {} }))
  await mountBand($)
  await $.command.run({ command: COMMAND, args: 'settings', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)
  expect(opened).toHaveLength(1)
  const pane = await $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'Pane', requestId: 'dictate-cli-settings', props: { title: 'DictateCLI' } as never })
  expect(await pane.find({ text: /Claude Code default \(English\)/ })).toBeDefined()
  expect(await pane.find({ text: /\/config/ })).toBeDefined()
})

test('chord labels read like the app: alt+d → Alt+D', () => {
  expect(chordLabel('alt+d')).toBe('Alt+D')
  expect(chordLabel('ctrl+shift+k')).toBe('Ctrl+Shift+K')
})
