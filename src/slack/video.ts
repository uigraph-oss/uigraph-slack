import type { McpClient } from '@uigraph/ai-sdk'
import { z } from 'zod'

// A video is delivered into the thread as an MP4 file so it plays inline. When it is still
// rendering, the bot waits for the render and posts the file once it is ready.

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
  | { status: 'ready'; title: string; filename: string; src: string }
  | { status: 'pending' }

const showVideoResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(
    z.looseObject({
      type: z.string(),
      uri: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
    })
  ),
})

// show_video names the rendered MP4 in a resource link. Before the render is done it only says so
// in text, without a link.
export function parseShowVideo(reply: unknown): ShownVideo {
  const result = showVideoResult.parse(reply)
  if (result.isError === true) {
    throw new Error(`show_video failed: ${JSON.stringify(result.content)}`)
  }
  for (const part of result.content) {
    if (part.type !== 'resource_link' || part.mimeType !== 'video/mp4') {
      continue
    }
    if (part.uri === undefined || part.name === undefined) {
      throw new Error('show_video returned a video link without its address')
    }
    return {
      status: 'ready',
      title: part.description ?? part.name,
      filename: part.name,
      src: part.uri,
    }
  }
  return { status: 'pending' }
}

export async function showVideo(
  client: McpClient,
  docId: string
): Promise<ShownVideo> {
  return parseShowVideo(
    await client.callTool({ name: 'show_video', arguments: { doc_id: docId } })
  )
}

export type RenderedVideo = { title: string; filename: string; data: Buffer }

export type FollowUp = {
  docId: string
  show: (docId: string) => Promise<ShownVideo>
  deliver: (video: RenderedVideo) => Promise<void>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollMs?: number
  timeoutMs?: number
  log?: (message: string) => void
}

// Waits for the render, downloads the MP4 and hands it to deliver. Returns what happened; it never
// throws, so a caller running it in the background can report the outcome instead.
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
        await options.deliver({
          title: shown.title,
          filename: shown.filename,
          data: Buffer.from(await response.arrayBuffer()),
        })
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
