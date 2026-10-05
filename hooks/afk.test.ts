import { expect, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 9, top: 0 }, view: {} }
const AFK = {
  name: 'afk',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const original = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return h(Box, { flexDirection: 'column' }, original, h(Box, { flexDirection: 'row', alignSelf: 'flex-start', borderStyle: 'single', paddingX: 1 }, h(Text, {}, 'AFK')))
    })
  },
}

for (const beside of [false, true]) {
  test(`with an AFK-like plugin in the band (beside ${beside})`, { plugins: [AFK], options: { beside } }, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
    const ui = await $.ui.mount({ plugin: 'dictate', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
    expect(await ui.find({ key: 'mic' })).toBeDefined()
  })
}
