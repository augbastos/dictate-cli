import { expect, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 9, top: 0 }, view: {} }
const OTHER = {
  name: 'other-band-plugin',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const original = await next(e)
      const { Box, Text } = $.ui.resolve(e)
      return h(Box, { flexDirection: 'column' }, original, h(Box, { flexDirection: 'row', alignSelf: 'flex-start', borderStyle: 'single', paddingX: 1 }, h(Text, {}, 'Other')))
    })
  },
}

for (const beside of [false, true]) {
  test(`with another plugin's card in the band (beside ${beside})`, { plugins: [OTHER], options: { beside } }, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
    const ui = await $.ui.mount({ plugin: 'dictate-cli', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
    expect(await ui.find({ key: 'mic' })).toBeDefined()
  })
}
