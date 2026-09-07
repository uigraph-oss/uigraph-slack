import { env } from '@/env'
import { logger } from '@/logger'

export type SlackInstallation = {
  orgId: string
  teamId: string
  botUserId: string
  botToken: string
  uigraphToken: string
}

const CACHE_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, { value: SlackInstallation; expiresAt: number }>()

function internalHeaders(): Record<string, string> {
  if (env.mode !== 'http') {
    throw new Error('Installation lookup is only available in HTTP mode')
  }
  return { 'X-Internal-Token': env.UIGRAPH_ENTERPRISE_INTERNAL_TOKEN }
}

function installationUrl(teamId: string): string {
  return `${env.UIGRAPH_API_URL}/internal/v1/slack-app/installations/${encodeURIComponent(teamId)}`
}

export async function getInstallation(
  teamId: string
): Promise<SlackInstallation | undefined> {
  const cached = cache.get(teamId)
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const response = await fetch(installationUrl(teamId), {
    headers: internalHeaders(),
  })
  if (response.status === 404) {
    cache.delete(teamId)
    return undefined
  }
  if (!response.ok) {
    throw new Error(
      `Installation lookup failed for team ${teamId}: status ${response.status}`
    )
  }

  const value = (await response.json()) as SlackInstallation
  cache.set(teamId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

export async function removeInstallation(teamId: string): Promise<void> {
  cache.delete(teamId)

  const response = await fetch(installationUrl(teamId), {
    method: 'DELETE',
    headers: internalHeaders(),
  })
  if (response.status === 404) {
    logger
      .withTag('uigraph')
      .warn(`Installation for team ${teamId} was already removed`)
    return
  }
  if (!response.ok) {
    throw new Error(
      `Installation removal failed for team ${teamId}: status ${response.status}`
    )
  }
}

export function evictInstallation(teamId: string): void {
  cache.delete(teamId)
}
