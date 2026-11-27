// uigraph-api's route for Autopilot buttons. It checks Slack's signature itself and acts as the
// clicking user's linked UIGraph account.
export const API_INTERACTIVITY_PATH = '/api/v1/slack-app/interactivity'

// Slack waits 3 seconds for an interaction to be acknowledged.
export const FORWARD_TIMEOUT_MS = 2500

// Only what the API needs to check Slack's signature and read the form travels with the body.
const FORWARDED_HEADERS = [
  'content-type',
  'x-slack-signature',
  'x-slack-request-timestamp',
]

function isForm(contentType: string | null): boolean {
  return (contentType ?? '')
    .toLowerCase()
    .startsWith('application/x-www-form-urlencoded')
}

// A block_actions interaction with a button whose action_id starts with autopilot_. Anything that
// does not parse is not one, and stays with the bot.
export function isAutopilotInteraction(body: Uint8Array<ArrayBuffer>): boolean {
  try {
    const payload = new URLSearchParams(new TextDecoder().decode(body)).get(
      'payload'
    )
    if (payload === null) return false
    const parsed = JSON.parse(payload) as {
      type?: unknown
      actions?: Array<{ action_id?: unknown }>
    }
    return (
      parsed.type === 'block_actions' &&
      Array.isArray(parsed.actions) &&
      parsed.actions.some(
        (action) =>
          typeof action?.action_id === 'string' &&
          action.action_id.startsWith('autopilot_')
      )
    )
  } catch {
    return false
  }
}

type Route = {
  apiUrl: string
  // The bot's own Slack webhook handler, for everything that is not an Autopilot button.
  handle: (request: Request) => Promise<Response>
  // Kept out of this module so it loads without the app's environment, as in tests.
  log: (message: string, error?: unknown) => void
  fetch?: typeof fetch
  timeoutMs?: number
}

// Slack has one interactivity URL, and it points here. Autopilot's buttons are handled by
// uigraph-api, so their clicks are passed on as Slack sent them: the same bytes and Slack's own
// signature headers, never re-signed, so the API verifies Slack and this app is not a trusted
// hop. Event callbacks (JSON) are not read at all; other forms are handed to the bot unchanged.
export async function routeSlackRequest(
  request: Request,
  route: Route
): Promise<Response> {
  if (request.method !== 'POST' || !isForm(request.headers.get('content-type')))
    return route.handle(request)

  const body = new Uint8Array(await request.arrayBuffer())
  if (!isAutopilotInteraction(body)) {
    return route.handle(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      })
    )
  }
  return forward(body, request.headers, route)
}

async function forward(
  body: Uint8Array<ArrayBuffer>,
  incoming: Headers,
  route: Route
): Promise<Response> {
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name)
    if (value !== null) headers.set(name, value)
  }
  const url = `${route.apiUrl.replace(/\/$/, '')}${API_INTERACTIVITY_PATH}`
  try {
    const response = await (route.fetch ?? fetch)(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(route.timeoutMs ?? FORWARD_TIMEOUT_MS),
    })
    const answer = await response.arrayBuffer()
    if (response.status >= 500) {
      route.log(`Autopilot action: the API failed with ${response.status}`)
      return new Response(null, { status: 200 })
    }
    if (!response.ok) {
      route.log(`Autopilot action: the API refused it with ${response.status}`)
    }
    const contentType = response.headers.get('content-type')
    return new Response(answer, {
      status: response.status,
      headers: contentType === null ? {} : { 'content-type': contentType },
    })
  } catch (error) {
    // Slack shows the clicker an error for anything but a 200, and retrying will not help, so
    // a failed hand-off (down, timed out, or a 5xx above) is logged and acknowledged. A 4xx,
    // such as a refused signature, is passed back as it is.
    route.log('Autopilot action: could not reach the API', error)
    return new Response(null, { status: 200 })
  }
}
