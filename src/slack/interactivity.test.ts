import { describe, expect, it, vi } from 'vitest'
import {
  API_INTERACTIVITY_PATH,
  isAutopilotInteraction,
  routeSlackRequest,
} from './interactivity'

const API = 'http://uigraph-api:8080/'
const SIGNATURE =
  'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503'
const TIMESTAMP = '1531420618'

// Slack's form body. The payload's JSON is percent-encoded with + for spaces, exactly as Slack
// sends it; the test checks these bytes arrive unchanged, encoding quirks included.
function formBody(actionId: string): Uint8Array<ArrayBuffer> {
  const payload = JSON.stringify({
    type: 'block_actions',
    user: { id: 'U1' },
    team: { id: 'T1' },
    actions: [{ action_id: actionId, value: 'task 1' }],
  })
  return new TextEncoder().encode(
    `payload=${encodeURIComponent(payload).replaceAll('%20', '+')}`
  )
}

function slackRequest(
  body: Uint8Array<ArrayBuffer> | string,
  contentType: string
) {
  return new Request('http://slack-app/slack/events', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-signature': SIGNATURE,
      'x-slack-request-timestamp': TIMESTAMP,
      'x-forwarded-for': '1.2.3.4',
    },
    body,
  })
}

const FORM = 'application/x-www-form-urlencoded'

function route(fetchImpl: typeof fetch, timeoutMs?: number) {
  const handled: Request[] = []
  const log = vi.fn()
  return {
    handled,
    log,
    options: {
      apiUrl: API,
      log,
      fetch: fetchImpl,
      timeoutMs,
      handle: async (request: Request) => {
        handled.push(request)
        return new Response('bot')
      },
    },
  }
}

describe('routeSlackRequest', () => {
  it('passes an autopilot_ click to the API byte for byte, with Slack’s headers', async () => {
    const body = formBody('autopilot_verdict_wrong')
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
    const r = route(fetchImpl as unknown as typeof fetch)
    const response = await routeSlackRequest(
      slackRequest(body, FORM),
      r.options
    )

    expect(r.handled).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`http://uigraph-api:8080${API_INTERACTIVITY_PATH}`)
    expect(init.method).toBe('POST')
    expect(Buffer.from(init.body as Uint8Array).equals(Buffer.from(body))).toBe(
      true
    )
    const headers = new Headers(init.headers)
    expect(headers.get('x-slack-signature')).toBe(SIGNATURE)
    expect(headers.get('x-slack-request-timestamp')).toBe(TIMESTAMP)
    expect(headers.get('content-type')).toBe(FORM)
    expect(headers.get('x-forwarded-for')).toBeNull()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}')
    expect(response.headers.get('content-type')).toBe('application/json')
  })

  it('hands every other action to the bot unchanged and never calls the API', async () => {
    const fetchImpl = vi.fn()
    const r = route(fetchImpl as unknown as typeof fetch)
    for (const actionId of ['approve_video', 'ask', 'xautopilot_x']) {
      const body = formBody(actionId)
      const response = await routeSlackRequest(
        slackRequest(body, FORM),
        r.options
      )
      expect(await response.text()).toBe('bot')
      const passed = r.handled.at(-1) as Request
      expect(
        Buffer.from(await passed.arrayBuffer()).equals(Buffer.from(body))
      ).toBe(true)
      expect(passed.headers.get('x-slack-signature')).toBe(SIGNATURE)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves event callbacks and slash commands to the bot', async () => {
    const fetchImpl = vi.fn()
    const r = route(fetchImpl as unknown as typeof fetch)
    const event = slackRequest(
      '{"type":"event_callback","event":{"text":"autopilot_verdict_wrong"}}',
      'application/json'
    )
    await routeSlackRequest(event, r.options)
    expect(r.handled[0]).toBe(event)
    await routeSlackRequest(
      slackRequest('command=%2Fuigraph&text=autopilot_x', FORM),
      r.options
    )
    expect(r.handled).toHaveLength(2)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('acknowledges safely when the API is down, failing or slow', async () => {
    const down = route(async () => {
      throw new TypeError('fetch failed')
    })
    const failing = route(async () => new Response('boom', { status: 502 }))
    const slow = route(
      (async (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          )
        })) as unknown as typeof fetch,
      20
    )
    for (const r of [down, failing, slow]) {
      const response = await routeSlackRequest(
        slackRequest(formBody('autopilot_verdict_right'), FORM),
        r.options
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('')
      expect(r.log).toHaveBeenCalled()
      expect(r.handled).toHaveLength(0)
    }
  })

  it('passes a refusal such as a bad signature back as it is', async () => {
    const r = route(async () => new Response('unauthorized', { status: 401 }))
    const response = await routeSlackRequest(
      slackRequest(formBody('autopilot_verdict_right'), FORM),
      r.options
    )
    expect(response.status).toBe(401)
  })
})

function encode(text: string) {
  return new TextEncoder().encode(text)
}

describe('isAutopilotInteraction', () => {
  it('ignores bodies that are not a block_actions payload', () => {
    expect(isAutopilotInteraction(encode('payload=not-json'))).toBe(false)
    expect(isAutopilotInteraction(encode('payload=%7B%7D'))).toBe(false)
    expect(
      isAutopilotInteraction(
        encode(
          `payload=${encodeURIComponent('{"type":"view_submission","actions":[{"action_id":"autopilot_x"}]}')}`
        )
      )
    ).toBe(false)
  })
})

describe('Autopilot action ids', () => {
  it.each([
    'autopilot_verdict_right',
    'autopilot_verdict_wrong',
    'autopilot_check_now',
    'autopilot_not_for_autopilot',
    'autopilot_mute',
  ])('passes %s through to the API', (actionId) => {
    expect(isAutopilotInteraction(formBody(actionId))).toBe(true)
  })

  it('keeps look-alikes with the bot', () => {
    expect(isAutopilotInteraction(formBody('ask_autopilot_mute'))).toBe(false)
  })
})
