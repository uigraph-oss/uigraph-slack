import { slackifyMarkdown } from 'slackify-markdown'

function rowCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function stripWrappingEmphasis(cell: string): string {
  return cell
    .replace(/^[*_]+/, '')
    .replace(/[*_]+$/, '')
    .trim()
}

export function tablesToBullets(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []

  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(line)
      i++
      continue
    }

    if (inFence) {
      out.push(line)
      i++
      continue
    }

    const isRow = /^\s*\|.*\|\s*$/.test(line)
    const next = lines[i + 1] ?? ''
    const isSeparator =
      next.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next)

    if (isRow && isSeparator) {
      const headers = rowCells(line)
      i += 2
      while (
        i < lines.length &&
        !/^\s*(```|~~~)/.test(lines[i]) &&
        /^\s*\|.*\|\s*$/.test(lines[i])
      ) {
        const cells = rowCells(lines[i])
        const first = stripWrappingEmphasis(cells[0] ?? '')
        const rest = cells.slice(1)
        const detail = rest
          .map((value, index) => {
            const header = stripWrappingEmphasis(headers[index + 1] ?? '')
            if (headers.length <= 2 || header === '') {
              return value
            }
            return `${header}: ${value}`
          })
          .filter((part) => part !== '')
          .join(' · ')
        out.push(
          first === ''
            ? `- ${detail}`
            : detail === ''
              ? `- **${first}**`
              : `- **${first}** — ${detail}`
        )
        i++
      }
      continue
    }

    out.push(line)
    i++
  }

  return out.join('\n')
}

export function rulesToBlankLines(text: string): string {
  return text.replace(/^\*\*\*$\n?/gm, '').replace(/\n{4,}/g, '\n\n\n')
}

export interface NormalizedSlackMessage {
  message: string
  assets: string[]
}

export function normalizeSlackMessage(
  markdown: string
): NormalizedSlackMessage {
  const withBullets = tablesToBullets(markdown)

  const assets: string[] = []
  const message = withBullets.replace(
    /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, url) => {
      assets.push(url)
      return ''
    }
  )

  return { message, assets }
}

export function formatForSlack(markdown: string): NormalizedSlackMessage {
  const { message, assets } = normalizeSlackMessage(markdown)
  return {
    message: rulesToBlankLines(slackifyMarkdown(message)),
    assets,
  }
}
