import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
function prompt(file: string) {
  return readFileSync(join(__dirname, 'prompts', file), 'utf-8')
}

export const SLACK_BOT_SYSTEM_PROMPT = prompt('slack-bot.md')
