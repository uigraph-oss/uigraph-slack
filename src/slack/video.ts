import type { webApi } from '@slack/bolt'

// A video made from Slack is delivered in two steps: the watch link goes out at once, and once
// the MP4 is rendered it is uploaded into the thread so it plays inline.

const DOC_ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'

// The documents a turn created, read from create_video's own reply.
export function createdVideoIds(toolOutputs: string[]): string[] {
  const ids: string[] = []
  const pattern = new RegExp(
    `Created the video[^\\n]*\\n[\\s\\S]*?\\*\\*DocID:\\*\\* \`${DOC_ID}\``,
    'g'
  )
  for (const output of toolOutputs) {
    for (const match of output.matchAll(pattern)) {
      if (!ids.includes(match[1])) ids.push(match[1])
    }
  }
  return ids
}

export function watchUrl(frontendUrl: string, docId: string): string {
  return `${frontendUrl.replace(/\/$/, '')}/dashboard/library/${docId}/watch`
}

export type ShownVideo =
  { status: 'ready'; title: string; src: string } | { status: 'pending' }

// Asks the MCP server for the rendered file, as show_video does for Claude. Ready once the reply
// carries the file's address; before that the server says it is still being made.
export type ShowVideo = (docId: string) => Promise<ShownVideo>

export function parseShowVideo(result: {
  structuredContent?: unknown
}): ShownVideo {
  const content = result.structuredContent as
    { src?: unknown; title?: unknown } | undefined
  if (content && typeof content.src === 'string' && content.src !== '') {
    return {
      status: 'ready',
      title: typeof content.title === 'string' ? content.title : 'video',
      src: content.src,
    }
  }
  return { status: 'pending' }
}

type Upload = Pick<webApi.WebClient['files'], 'uploadV2'>

export type FollowUp = {
  files: Upload
  channel: string
  threadTs: string | undefined
  docId: string
  show: ShowVideo
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollMs?: number
  timeoutMs?: number
  log?: (message: string) => void
}

function safeName(title: string): string {
  return `${title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'video'}.mp4`
}

// Waits for the render and uploads the MP4 into the thread. Returns what happened; it never
// throws, because the watch link has already been posted and is the fallback.
export async function uploadWhenRendered(
  options: FollowUp
): Promise<'uploaded' | 'timeout' | 'failed'> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = options.now ?? (() => Date.now())
  const pollMs = options.pollMs ?? 15_000
  const deadline = now() + (options.timeoutMs ?? 6 * 60_000)
  try {
    for (;;) {
      const shown = await options.show(options.docId)
      if (shown.status === 'ready') {
        const response = await (options.fetch ?? fetch)(shown.src)
        if (!response.ok) {
          options.log?.(`Video download failed: status ${response.status}`)
          return 'failed'
        }
        await options.files.uploadV2({
          channel_id: options.channel,
          ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
          file: Buffer.from(await response.arrayBuffer()),
          filename: safeName(shown.title),
          title: shown.title,
        } as Parameters<Upload['uploadV2']>[0])
        return 'uploaded'
      }
      if (now() + pollMs > deadline) return 'timeout'
      await sleep(pollMs)
    }
  } catch (error) {
    options.log?.(`Video follow-up failed: ${String(error)}`)
    return 'failed'
  }
}
