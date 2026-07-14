import { type ConsolaReporter, createConsola } from 'consola'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { z } from 'zod'

const logsDir = join(process.cwd(), '.logs')
mkdirSync(logsDir, { recursive: true })

const logFilePath = join(logsDir, `${Date.now()}-${process.pid}.log`)

const fileStream = createWriteStream(logFilePath, { flags: 'a' })

const fileReporter: ConsolaReporter = {
  log(logObj) {
    const date = logObj.date.toISOString()
    const type = logObj.type.toUpperCase()
    const tag = logObj.tag ? `[${logObj.tag}] ` : ''
    const message = logObj.args
      .map((arg) =>
        typeof arg === 'string' ? arg : inspect(arg, { depth: 5 })
      )
      .join(' ')
    fileStream.write(`${date} [${type}] ${tag}${message}\n`)
  },
}

const debugMode = z
  .stringbool()
  .default(false)
  .parse(process.env.SLACK_BOT_DEBUG_MODE)

export const logger = createConsola({ level: debugMode ? 999 : 0 })
logger.addReporter(fileReporter)
