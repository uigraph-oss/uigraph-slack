import { logger } from '@/logger'
import type { SlackMessage } from '@/types'
import type { webApi } from '@slack/bolt'
import { inspect } from 'node:util'

export const AGENT_TURN_EVENT_TYPE = 'uigraph_agent_turn'

const METADATA_CHAR_LIMIT = 12000

type PostMetadata = NonNullable<webApi.ChatPostMessageArguments['metadata']>

export function buildTurnMetadata(
  toolOutputs: unknown[]
): PostMetadata | undefined {
  if (toolOutputs.length === 0) {
    return undefined
  }

  const metadata = {
    event_type: AGENT_TURN_EVENT_TYPE,
    event_payload: { toolOutputs },
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

  logger
    .withTag('slack')
    .verbose(
      `Turn metadata (${size} chars): ${inspect(metadata, { depth: null })}`
    )
  return metadata as unknown as PostMetadata
}

export function readToolOutputs(message: SlackMessage): unknown[] | undefined {
  const metadata = message.metadata
  if (metadata === undefined) {
    return undefined
  }
  if (metadata.event_type !== AGENT_TURN_EVENT_TYPE) {
    return undefined
  }

  const toolOutputs = metadata.event_payload?.toolOutputs
  if (!Array.isArray(toolOutputs)) {
    return undefined
  }

  logger
    .withTag('slack')
    .verbose(
      `Restored ${toolOutputs.length} tool output(s) from turn metadata: ${inspect(toolOutputs, { depth: null })}`
    )
  return toolOutputs
}
