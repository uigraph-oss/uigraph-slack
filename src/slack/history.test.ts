import { describe, expect, it, vi } from 'vitest'

vi.mock('@/env', () => ({
  env: {
    LLM_MESSAGES_LIMIT: 25,
    LLM_CONTEXT_TOKENS: 100000,
    LLM_ATTACHMENT_IMAGE: false,
    LLM_ATTACHMENT_AUDIO: false,
    LLM_ATTACHMENT_VIDEO: false,
  },
}))
vi.mock('@/logger', () => ({
  logger: { withTag: () => ({ error: vi.fn(), info: vi.fn() }) },
}))

// vitest runs without the @/ path alias; the real module is used through its relative path.
vi.mock('@/slack/asker', () => import('./asker'))

const { buildTurn } = await import('./history')

type Fake = Parameters<typeof buildTurn>[0]

function message(id: string, text: string, isMe = false) {
  return {
    id,
    text,
    attachments: [],
    author: { userId: isMe ? 'B1' : 'U1', fullName: 'Ana', isMe, isBot: isMe },
  }
}

// A thread whose adapter answers like Slack: conversations.replies fails without a thread ts.
function thread(id: string) {
  const replies = vi.fn(async (threadId: string) => {
    if (threadId.split(':')[2] === '') throw new Error('thread_not_found')
    return { messages: [message('1.000001', 'in a thread')] }
  })
  const history = vi.fn(async () => ({
    messages: [
      message('1.000001', 'earlier question'),
      message('1.000002', 'earlier answer', true),
      message('1.000003', 'what is in my queue?'),
    ],
  }))
  const fake = {
    id,
    adapter: { fetchMessages: replies, fetchChannelMessages: history },
  } as unknown as Fake
  return { fake, replies, history }
}

describe('buildTurn', () => {
  it('reads a top-level DM from the channel, not thread replies', async () => {
    const { fake, replies, history } = thread('slack:D123:')
    const turn = await buildTurn(fake, 'U1', [], undefined)
    expect(replies).not.toHaveBeenCalled()
    expect(history).toHaveBeenCalledWith('slack:D123', { limit: 25 })
    expect(turn.input.map((m) => m.slackMessageId)).toEqual([
      '1.000001',
      '1.000002',
      '1.000003',
    ])
  })

  it('reads a thread from its replies', async () => {
    const { fake, replies, history } = thread('slack:D123:1.000001')
    const turn = await buildTurn(fake, 'U1', [], undefined)
    expect(history).not.toHaveBeenCalled()
    expect(replies).toHaveBeenCalledWith('slack:D123:1.000001', { limit: 25 })
    expect(turn.input).toHaveLength(1)
  })
})
