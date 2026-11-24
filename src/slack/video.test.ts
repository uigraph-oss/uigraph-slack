import { describe, expect, it } from 'vitest'
import {
  createdVideoIds,
  parseShowVideo,
  uploadWhenRendered,
  watchUrl,
  type ShownVideo,
} from './video'

const ID = '2db7033c-a4aa-40eb-8811-80524aee3d9b'

describe('createdVideoIds', () => {
  it('reads the document a create_video reply names', () => {
    const reply = `Created the video "How checkout works".\n\n- **DocID:** \`${ID}\`\n\nWatch it at /dashboard/library/${ID}/watch`
    expect(createdVideoIds([reply])).toEqual([ID])
  })

  it('ignores other tool output that happens to show a doc id', () => {
    const other = `# Walkthrough videos\n\n- **DocID:** \`${ID}\`\n  - **Title:** x`
    expect(createdVideoIds([other])).toEqual([])
  })
})

describe('watchUrl and parseShowVideo', () => {
  it('builds the watch page address', () => {
    expect(watchUrl('https://app.example/', ID)).toBe(
      `https://app.example/dashboard/library/${ID}/watch`
    )
  })

  it('is ready only once the reply carries the file address', () => {
    expect(
      parseShowVideo({
        structuredContent: { src: 'https://mcp/x', title: 'T' },
      })
    ).toEqual({ status: 'ready', title: 'T', src: 'https://mcp/x' })
    expect(parseShowVideo({})).toEqual({ status: 'pending' })
    expect(parseShowVideo({ structuredContent: { src: '' } })).toEqual({
      status: 'pending',
    })
  })
})

describe('uploadWhenRendered', () => {
  function setup(sequence: ShownVideo[]) {
    const uploads: unknown[] = []
    let clock = 0
    const options = {
      files: {
        uploadV2: async (args: unknown) => {
          uploads.push(args)
          return {}
        },
      } as never,
      channel: 'C1',
      threadTs: '1.2',
      docId: ID,
      show: async () => sequence.shift() ?? { status: 'pending' as const },
      fetch: (async () => new Response('mp4-bytes')) as unknown as typeof fetch,
      sleep: async (ms: number) => {
        clock += ms
      },
      now: () => clock,
      pollMs: 15_000,
      timeoutMs: 60_000,
    }
    return { options, uploads }
  }

  it('waits for the render, then uploads the file into the thread', async () => {
    const { options, uploads } = setup([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'ready', title: 'How checkout works', src: 'https://mcp/v' },
    ])
    expect(await uploadWhenRendered(options)).toBe('uploaded')
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      channel_id: 'C1',
      thread_ts: '1.2',
      filename: 'How-checkout-works.mp4',
    })
  })

  it('gives up quietly when the render never finishes', async () => {
    const { options, uploads } = setup([])
    expect(await uploadWhenRendered(options)).toBe('timeout')
    expect(uploads).toHaveLength(0)
  })

  it('does not throw when the download or upload fails', async () => {
    const { options } = setup([
      { status: 'ready', title: 'T', src: 'https://mcp/v' },
    ])
    expect(
      await uploadWhenRendered({
        ...options,
        fetch: (async () => new Response('no', { status: 502 })) as never,
      })
    ).toBe('failed')
  })
})
