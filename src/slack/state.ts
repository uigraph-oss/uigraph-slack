import type { Lock, QueueEntry, StateAdapter } from 'chat'

// Keeps the bot's state (followed threads, thread locks, thread memory, queued messages) in
// UIGraph through the API's internal Slack routes, so every replica shares it and it survives
// restarts. A TTL of 0 or none means the value does not expire, as in Chat SDK's own adapters.
export function createApiState(apiUrl: string, internalToken: string) {
  const base = `${apiUrl}/internal/v1/slack-app/state`

  async function call(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await fetch(`${base}/${path}`, {
      method,
      headers: {
        'X-Internal-Token': internalToken,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(
        `Slack state ${method} ${path} failed: status ${response.status} ${await response.text()}`
      )
    }
    if (response.status === 204) return undefined
    return response.json()
  }

  function ttl(ttlMs: number | undefined) {
    return ttlMs ? { ttlMs } : {}
  }

  const id = encodeURIComponent

  const state: StateAdapter = {
    async connect() {},
    async disconnect() {},

    async subscribe(threadId) {
      await call('PUT', `subscriptions/${id(threadId)}`)
    },
    async unsubscribe(threadId) {
      await call('DELETE', `subscriptions/${id(threadId)}`)
    },
    async isSubscribed(threadId) {
      const result = (await call('GET', `subscriptions/${id(threadId)}`)) as {
        subscribed: boolean
      }
      return result.subscribed
    },

    async acquireLock(threadId, ttlMs) {
      const result = (await call('POST', `locks/${id(threadId)}`, {
        ttlMs,
      })) as { lock: Lock | null }
      return result.lock
    },
    async extendLock(lock, ttlMs) {
      const result = (await call('POST', `locks/${id(lock.threadId)}/extend`, {
        token: lock.token,
        ttlMs,
      })) as { extended: boolean }
      return result.extended
    },
    async releaseLock(lock) {
      await call('POST', `locks/${id(lock.threadId)}/release`, {
        token: lock.token,
      })
    },
    async forceReleaseLock(threadId) {
      await call('DELETE', `locks/${id(threadId)}`)
    },

    async get<T>(key: string) {
      const result = (await call('GET', `values/${id(key)}`)) as {
        value: T | null
      }
      return result.value
    },
    async set(key, value, ttlMs) {
      await call('PUT', `values/${id(key)}`, { value, ...ttl(ttlMs) })
    },
    async setIfNotExists(key, value, ttlMs) {
      const result = (await call('POST', `values/${id(key)}/create`, {
        value,
        ...ttl(ttlMs),
      })) as { created: boolean }
      return result.created
    },
    async delete(key) {
      await call('DELETE', `values/${id(key)}`)
    },

    async appendToList(key, value, options) {
      await call('POST', `lists/${id(key)}/append`, {
        value,
        maxLength: options?.maxLength ?? 0,
        ...ttl(options?.ttlMs),
      })
    },
    async getList<T>(key: string) {
      const result = (await call('GET', `lists/${id(key)}`)) as {
        values: T[]
      }
      return result.values
    },

    async enqueue(threadId, entry, maxSize) {
      const result = (await call('POST', `queues/${id(threadId)}/enqueue`, {
        entry,
        expiresAt: entry.expiresAt,
        maxSize,
      })) as { depth: number }
      return result.depth
    },
    async dequeue(threadId) {
      const result = (await call('POST', `queues/${id(threadId)}/dequeue`)) as {
        entry: QueueEntry | null
      }
      return result.entry
    },
    async queueDepth(threadId) {
      const result = (await call('GET', `queues/${id(threadId)}`)) as {
        depth: number
      }
      return result.depth
    },
  }
  return state
}
