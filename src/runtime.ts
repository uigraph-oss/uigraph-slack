import type { App } from '@slack/bolt'
import type { ToolSet } from 'ai'

export type Runtime = {
  app: App
  getTools(teamId: string | undefined): Promise<ToolSet>
  close(): Promise<void>
}
