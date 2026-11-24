import type {
  AssistantModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from 'ai'

export type SessionContent =
  UserModelMessage | AssistantModelMessage | ToolModelMessage

// One message of the bot's conversation with the AI model in a thread, kept exactly as it was
// sent or received so the next turn replays the same prompt and the provider's cache keeps
// working. askerId is set on the model's messages: the person whose access the turn ran with.
// The token counts are set on each model call's assistant message.
export type NewSessionMessage = {
  content: SessionContent
  slackMessageId?: string
  askerId?: string
  model?: string
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
}

export type SessionMessage = NewSessionMessage & { seq: number }

export type SessionStore = {
  load(threadId: string): Promise<SessionMessage[]>
  append(
    threadId: string,
    teamId: string | undefined,
    messages: NewSessionMessage[]
  ): Promise<void>
  replace(
    threadId: string,
    messages: Array<{ seq: number; content: SessionContent }>
  ): Promise<void>
}

// Keeps sessions in UIGraph through the API's internal Slack routes, shared by every replica.
export function createApiSessions(
  apiUrl: string,
  internalToken: string
): SessionStore {
  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    threadId: string,
    body?: unknown
  ): Promise<unknown> {
    const path = `sessions/${encodeURIComponent(threadId)}/messages`
    const response = await fetch(`${apiUrl}/internal/v1/slack-app/${path}`, {
      method,
      headers: {
        'X-Internal-Token': internalToken,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(
        `Slack session ${method} ${path} failed: status ${response.status} ${await response.text()}`
      )
    }
    if (response.status === 204) return undefined
    return response.json()
  }

  return {
    async load(threadId) {
      const result = (await call('GET', threadId)) as {
        messages: SessionMessage[]
      }
      return result.messages
    },
    async append(threadId, teamId, messages) {
      await call('POST', threadId, {
        teamId,
        messages: messages.map((message) => ({
          ...message,
          role: message.content.role,
        })),
      })
    },
    async replace(threadId, messages) {
      await call('PATCH', threadId, { messages })
    },
  }
}

export function createMemorySessions(): SessionStore {
  const sessions = new Map<string, SessionMessage[]>()
  return {
    async load(threadId) {
      return structuredClone(sessions.get(threadId) ?? [])
    },
    async append(threadId, _teamId, messages) {
      const saved = sessions.get(threadId) ?? []
      for (const message of messages) {
        saved.push({ ...structuredClone(message), seq: saved.length + 1 })
      }
      sessions.set(threadId, saved)
    },
    async replace(threadId, messages) {
      const saved = sessions.get(threadId) ?? []
      for (const message of messages) {
        const target = saved.find((row) => row.seq === message.seq)
        if (target === undefined) {
          throw new Error(
            `Session ${threadId} has no message ${message.seq} to replace`
          )
        }
        target.content = structuredClone(message.content)
      }
    },
  }
}
