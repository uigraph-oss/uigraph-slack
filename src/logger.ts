import { type ConsolaReporter, createConsola } from 'consola'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

const logsDir = join(process.cwd(), '.logs')
mkdirSync(logsDir, { recursive: true })

const startedAt = new Date().toISOString().replace(/[:.]/g, '-')
const logFilePath = join(logsDir, `${startedAt}-${process.pid}.log`)

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

export const logger = createConsola({ level: 4 })
logger.addReporter(fileReporter)
