import type { McpClient } from '@uigraph/ai-sdk'
import type { ToolSet } from 'ai'

type Annotations = { [key: string]: unknown }

// A tool is safe to offer in Slack when it only reads or only adds. Anything that changes or
// removes what is there (update_*, delete_*, set_default_*) is left out, and so is any tool that
// says nothing: the protocol treats an unannotated tool as destructive. In a channel the asker's
// authority can be reached by text other people wrote, so the bot never offers those.
export function isSafeTool(annotations: Annotations | undefined): boolean {
  if (annotations === undefined) return false
  return (
    annotations.readOnlyHint === true || annotations.destructiveHint === false
  )
}

export async function onlySafeTools(
  client: McpClient,
  tools: ToolSet
): Promise<ToolSet> {
  const listed = await client.listTools()
  const safe = new Set(
    listed.tools
      .filter((tool) => isSafeTool(tool.annotations))
      .map((tool) => tool.name)
  )
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => safe.has(name))
  )
}
