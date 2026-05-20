import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

import type { JsonObject } from '@ai-dev-team/db'
import type { WebhookSignatureStatus } from '@ai-dev-team/shared'

function getHeaderValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return null
}

function safeCompareHex(expectedHex: string, headerHex: string): boolean {
  try {
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = Buffer.from(headerHex, 'hex')

    if (expected.length === 0 || actual.length === 0) {
      return false
    }

    if (expected.length !== actual.length) {
      return false
    }

    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function safeCompareUtf8(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, actualBuffer)
}

export function verifyLinearSignature(
  secret: string,
  rawBody: string,
  headerSignature: string | string[] | undefined,
): WebhookSignatureStatus {
  const signature = getHeaderValue(headerSignature)

  if (!signature) {
    return 'missing'
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

  return safeCompareHex(expected, signature) ? 'verified' : 'failed'
}

export function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  headerSignature: string | string[] | undefined,
): WebhookSignatureStatus {
  const signature = getHeaderValue(headerSignature)

  if (!signature) {
    return 'missing'
  }

  if (!signature.startsWith('sha256=')) {
    return 'failed'
  }

  const expected =
    'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')

  return safeCompareUtf8(expected, signature) ? 'verified' : 'failed'
}

export function isReplayWindowValid(
  now: Date,
  providerTimestamp: Date | null,
  replayWindowMs: number,
): boolean {
  if (!providerTimestamp) {
    return false
  }

  return Math.abs(now.getTime() - providerTimestamp.getTime()) <= replayWindowMs
}

export function serializeHeaders(headers: IncomingHttpHeaders): JsonObject {
  const serialized: JsonObject = {}

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      serialized[key] = value
      continue
    }

    if (Array.isArray(value)) {
      serialized[key] = value
    }
  }

  return serialized
}
