import type { ToolSet } from 'ai'

// Autopilot's MCP tools (autopilot_suggest_order, autopilot_status, autopilot_feedback, and any
// added later) answer about the asker's own work: their queue, their tasks and their verdicts.
export function isAutopilotTool(name: string): boolean {
  return name.startsWith('autopilot_')
}

// The channel reply when the answer went to the asker's DM. It says nothing about the answer.
export const SENT_PRIVATELY = 'Sent you a DM.'

const PRIVATE_NOTE = `This answers about the asker's own Autopilot work, which is private, so it is answered in their direct messages instead of here. Reply with exactly "${SENT_PRIVATELY}" and nothing else. Do not guess at the answer.`

// Anything outside a one-to-one DM is shared, group DMs included. There every Autopilot tool is
// replaced by a stand-in that never calls UIGraph: it records that the asker wants a private
// answer and tells the model only that. The model in the channel therefore never holds the
// queue, a status or a verdict, so neither its text nor a card it shows can post one. The bot
// then answers the same question in the asker's DM, where the real tools run.
//
// The stand-in keeps the tool's description and input schema, so the tools the model is offered
// are the same in a channel and a DM and the cached prompt prefix stays valid.
export function guardAutopilotTools(
  tools: ToolSet,
  isDM: boolean,
  onPrivate: () => void
): ToolSet {
  if (isDM) return tools
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => {
      if (!isAutopilotTool(name)) return [name, original]
      return [
        name,
        {
          ...original,
          // An MCP tool converts MCP content for the model; the stand-in returns plain text.
          toModelOutput: undefined,
          execute: async () => {
            onPrivate()
            return PRIVATE_NOTE
          },
        },
      ]
    })
  ) as ToolSet
}
