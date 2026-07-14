import { logger } from '@/logger'
import type { webApi } from '@slack/bolt'

const userNameCache: Record<string, string> = {}

export async function resolveUserName(
  client: webApi.WebClient,
  userId: string
): Promise<string> {
  const cached = userNameCache[userId]
  if (cached !== undefined) {
    return cached
  }
  try {
    const result = await client.users.info({ user: userId })
    const name = result.user?.real_name ?? result.user?.name ?? userId
    userNameCache[userId] = name
    return name
  } catch (error) {
    logger.withTag('slack').error(`Failed to resolve user ${userId}`, error)
    return userId
  }
}
