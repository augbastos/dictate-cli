import { expect, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 9, top: 0 }, view: {} }

// What lies beneath DictateCLI in the band: another plugin's tree, or the engine's own node.
for (const beside of [false, true])
for (const beneath of ['plugin', 'engine'] as const) {
  test(`band keeps what is beneath (${beneath}, beside ${beside}) and adds the mic`, { options: { beside } }, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      if (beneath === 'engine') return { type: 'engine', ref: 1 } as never
      const { Box, Text } = $.ui.resolve(e)
      return h(Box, { borderStyle: 'single', paddingX: 1 }, h(Text, {}, 'Other'))
    })
    const ui = await $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
    expect(await ui.find({ key: 'mic' })).toBeDefined()
    expect(await ui.find({ text: /DictateCLI/ })).toBeDefined()
    if (beneath === 'plugin') expect(await ui.find({ text: 'Other' })).toBeDefined()
  })
}
