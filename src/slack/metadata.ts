import { logger } from '@/logger'
import type { SlackMessage } from '@/types'
import type { webApi } from '@slack/bolt'
import { inspect } from 'node:util'

export const AGENT_TURN_EVENT_TYPE = 'uigraph_agent_turn'

const METADATA_CHAR_LIMIT = 12000

const TRUNCATION_MARKER = '\n\n[truncated]'

type PostMetadata = NonNullable<webApi.ChatPostMessageArguments['metadata']>

export function buildTurnMetadata(
  toolOutputs: string[]
): PostMetadata | undefined {
  if (toolOutputs.length === 0) {
    return undefined
  }

  function serializedSize(outputs: string[]): number {
    return JSON.stringify({
      event_type: AGENT_TURN_EVENT_TYPE,
      event_payload: { toolOutputs: outputs },
    }).length
  }

  const kept: string[] = []
  for (const output of toolOutputs) {
    if (serializedSize([...kept, output]) <= METADATA_CHAR_LIMIT) {
      kept.push(output)
      continue
    }

    let low = 0
    let high = output.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      const candidate = output.slice(0, mid) + TRUNCATION_MARKER
      if (serializedSize([...kept, candidate]) <= METADATA_CHAR_LIMIT) {
        low = mid
      } else {
        high = mid - 1
      }
    }
    if (low > 0) {
      kept.push(output.slice(0, low) + TRUNCATION_MARKER)
    }
    break
  }

  if (kept.length === 0) {
    logger
      .withTag('slack')
      .warn(
        `Turn metadata exceeds ${METADATA_CHAR_LIMIT} limit even after truncation; posting without metadata`
      )
    return undefined
  }

  const metadata = {
    event_type: AGENT_TURN_EVENT_TYPE,
    event_payload: { toolOutputs: kept },
  }
  const size = JSON.stringify(metadata).length
  logger
    .withTag('slack')
    .verbose(
      `Turn metadata (${size} chars): ${inspect(metadata, { depth: null })}`
    )
  return metadata as unknown as PostMetadata
}

export function readToolOutputs(message: SlackMessage): string[] | undefined {
  const metadata = message.metadata
  logger
    .withTag('slack')
    .verbose(`Raw message metadata: ${inspect(metadata, { depth: null })}`)
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
  return toolOutputs as string[]
}
