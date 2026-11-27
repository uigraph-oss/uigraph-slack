import { describe, expect, it } from 'vitest'
import { SLACK_BOT_SYSTEM_PROMPT } from './system-prompt'

// UIG-278, live 2026-11-27: the engineer replied "we need it in the uigraph-ui repo" and the bot
// told them to "set the repo on UIG-278 to uigraph-ui in the Autopilot page in UIGraph", which
// doesn't exist. The prompt must rule out invented actions and cover this exact exchange.
describe('slack bot prompt: only offer what exists', () => {
  it('tells the bot to suggest only real actions and to say plainly when it cannot', () => {
    expect(SLACK_BOT_SYSTEM_PROMPT).toContain(
      'Only suggest actions your tools or the product really offer'
    )
    expect(SLACK_BOT_SYSTEM_PROMPT).toContain(
      "When someone asks for something you can't do, say so plainly"
    )
  })

  it('covers the wrong-repo reply without inventing a setting', () => {
    const rule = SLACK_BOT_SYSTEM_PROMPT.slice(
      SLACK_BOT_SYSTEM_PROMPT.indexOf('## Only offer what exists'),
      SLACK_BOT_SYSTEM_PROMPT.indexOf('## Showing results')
    )
    expect(rule).toContain('we need it in the uigraph-ui repo')
    expect(rule).toContain("you can't change the repo for this ticket yet")
    expect(rule).toContain(
      'Do not tell them to set the repo in the Autopilot page'
    )
  })
})
