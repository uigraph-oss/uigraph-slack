import { env } from '@/env'
import { logger } from '@/logger'
import { createHttpRuntime } from '@/modes/http'
import { createSocketRuntime } from '@/modes/socket'
import type { Runtime } from '@/runtime'
import { registerHandlers } from '@/slack/handlers'

async function createRuntime(): Promise<Runtime> {
  if (env.mode === 'socket') {
    return createSocketRuntime()
  }
  if (env.mode === 'http') {
    return createHttpRuntime()
  }
  throw new Error(`Unknown mode ${String(env satisfies never)}`)
}

void (async () => {
  const runtime = await createRuntime()
  registerHandlers(runtime)

  async function shutdown(): Promise<void> {
    logger.info('Shutting down')
    await runtime.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  const port = process.env.PORT || 3000
  await runtime.app.start(port)
  logger.success(`⚡️ Bolt app is running in ${env.mode} mode on port ${port}`)
})()
