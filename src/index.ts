import { env } from '@/env'
import { logger } from '@/logger'
import { createHttpRuntime } from '@/modes/http'
import { createSocketRuntime } from '@/modes/socket'
import type { Runtime } from '@/runtime'
import { createBot } from '@/slack/bot'
import { createServer, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

async function createRuntime(): Promise<Runtime> {
  if (env.mode === 'socket') {
    return createSocketRuntime()
  }
  if (env.mode === 'http') {
    return createHttpRuntime()
  }
  throw new Error(`Unknown mode ${String(env satisfies never)}`)
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const name of Object.keys(req.headers)) {
    const value = req.headers[name]
    if (typeof value === 'string') headers.set(name, value)
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    }
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: 'half',
  } as RequestInit)
}

void (async () => {
  const runtime = await createRuntime()
  const bot = createBot(runtime)

  function waitUntil(task: Promise<unknown>) {
    task.catch((error: unknown) =>
      logger.withTag('slack').error('Background task failed', error)
    )
  }

  const page = runtime.page
  const server =
    page === undefined
      ? undefined
      : createServer((req, res) => {
          void (async () => {
            try {
              const request = toRequest(req)
              const response =
                new URL(request.url).pathname === '/slack/events'
                  ? await bot.webhooks.slack(request, { waitUntil })
                  : await page(request)
              res.writeHead(
                response.status,
                Object.fromEntries(response.headers)
              )
              res.end(Buffer.from(await response.arrayBuffer()))
            } catch (error) {
              logger.withTag('http').error(`${req.method} ${req.url}`, error)
              res.writeHead(500).end()
            }
          })()
        })

  async function shutdown(): Promise<void> {
    logger.info('Shutting down')
    server?.close()
    await bot.shutdown()
    await runtime.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await bot.initialize()
  if (server === undefined) {
    logger.success(`⚡️ Slack app is running in ${env.mode} mode`)
    return
  }
  const port = Number(process.env.PORT || 3000)
  server.listen(port, () => {
    logger.success(
      `⚡️ Slack app is running in ${env.mode} mode on port ${port}`
    )
  })
})()
