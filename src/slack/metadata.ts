import { logger } from '@/logger'
import type { SlackMessage } from '@/types'
import type { webApi } from '@slack/bolt'
import type { ModelMessage } from 'ai'

export const AGENT_TURN_EVENT_TYPE = 'uigraph_agent_turn'

const METADATA_CHAR_LIMIT = 12000

type PostMetadata = NonNullable<webApi.ChatPostMessageArguments['metadata']>

export function buildTurnMetadata(
  responseMessages: ModelMessage[]
): PostMetadata | undefined {
  const metadata = {
    event_type: AGENT_TURN_EVENT_TYPE,
    event_payload: { messages: responseMessages },
  }

  const size = JSON.stringify(metadata).length
  if (size > METADATA_CHAR_LIMIT) {
    logger
      .withTag('slack')
      .warn(
        `Turn metadata is ${size} chars, exceeds ${METADATA_CHAR_LIMIT} limit; posting without metadata`
      )
    return undefined
  }

  return metadata as unknown as PostMetadata
}

export function readTurnMessages(
  message: SlackMessage
): ModelMessage[] | undefined {
  const metadata = message.metadata
  if (metadata === undefined) {
    return undefined
  }
  if (metadata.event_type !== AGENT_TURN_EVENT_TYPE) {
    return undefined
  }

  const messages = metadata.event_payload?.messages
  if (!Array.isArray(messages)) {
    return undefined
  }

  return messages as ModelMessage[]
}
