import {apiVersion, projectId} from '@/lib/sanity/env'

/** True when `authorization` is a logged-in Sanity user (Studio), not a public read token misuse. */
export async function requireStudioUser(authorization: string | null): Promise<{ok: true; token: string} | {ok: false}> {
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return {ok: false}

  try {
    const response = await fetch(`https://${projectId}.api.sanity.io/v${apiVersion}/users/me`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return {ok: false}
    const me = (await response.json()) as {id?: string}
    if (!me?.id) return {ok: false}
    return {ok: true, token}
  } catch {
    return {ok: false}
  }
}