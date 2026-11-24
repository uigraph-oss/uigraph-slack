import type { SessionContent, SessionMessage } from '@/slack/session'

// A turn's tool calls and results ran with its asker's access, so they are only replayed to that
// same person: otherwise a second user in the thread would be answered from the first user's view
// of the data. Anyone else gets that turn as the text the bot wrote. Messages without an asker
// (people's own messages, and bot replies read back from Slack) are visible to everyone.
export function visibleTo(
  saved: SessionMessage[],
  askerId: string
): SessionContent[] {
  const visible: SessionContent[] = []
  for (const message of saved) {
    const content = message.content
    if (message.askerId === undefined || message.askerId === askerId) {
      visible.push(content)
      continue
    }
    if (content.role === 'assistant') {
      if (typeof content.content === 'string') {
        visible.push({ role: 'assistant', content: content.content })
        continue
      }
      const text = content.content.filter((part) => part.type === 'text')
      if (text.length > 0) visible.push({ role: 'assistant', content: text })
      continue
    }
    if (content.role === 'tool') continue
    visible.push(content)
  }
  return visible
}
