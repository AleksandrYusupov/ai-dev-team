import type { JsonObject } from '@ai-dev-team/db'
import type { ControlApiConfig } from '@ai-dev-team/config'
import type { FastifyPluginAsync } from 'fastify'
import {
  isSupportedGitHubEventType,
  isSupportedLinearEventType,
  type SupportedLinearEventType,
} from '@ai-dev-team/shared'

import type { WebhookIngressRepository } from '../app.js'
import { registerRawJsonParser } from '../webhooks/raw-json.js'
import {
  isReplayWindowValid,
  serializeHeaders,
  verifyGitHubSignature,
  verifyLinearSignature,
} from '../webhooks/verification.js'

interface WebhookRoutesOptions {
  config: ControlApiConfig
  webhookIngressRepository: WebhookIngressRepository
  now?: () => Date
}

interface ProviderRefs {
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
}

function asJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as JsonObject
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getNestedObject(
  value: JsonObject,
  key: string,
): JsonObject | null {
  return asJsonObject(value[key])
}

function deriveLinearRefs(
  payload: JsonObject,
  eventType: SupportedLinearEventType,
): ProviderRefs {
  const data = getNestedObject(payload, 'data')
  const subjectId = data ? getString(data.id) : null
  const directIssueId = data ? getString(data.issueId) : null
  const directProjectId = data ? getString(data.projectId) : null

  if (eventType === 'Issue') {
    return {
      issueId: subjectId,
      commentId: null,
      projectId: directProjectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'Comment') {
    return {
      issueId: directIssueId,
      commentId: subjectId,
      projectId: directProjectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'Project' || eventType === 'ProjectUpdate') {
    return {
      issueId: directIssueId,
      commentId: null,
      projectId: directProjectId ?? subjectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'IssueLabel') {
    return {
      issueId: directIssueId,
      commentId: null,
      projectId: directProjectId,
      repositoryFullName: null,
    }
  }

  return {
    issueId: directIssueId,
    commentId: null,
    projectId: directProjectId,
    repositoryFullName: null,
  }
}

function deriveGitHubRefs(payload: JsonObject): ProviderRefs {
  const repository = getNestedObject(payload, 'repository')

  return {
    issueId: null,
    commentId: null,
    projectId: null,
    repositoryFullName: repository ? getString(repository.full_name) : null,
  }
}

export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (
  app,
  options,
) => {
  registerRawJsonParser(app)

  app.post('/linear', async (request, reply) => {
    const payload = asJsonObject(request.body)
    const rawBody = request.rawBody

    if (!payload || typeof rawBody !== 'string') {
      return reply.status(400).send({ error: 'invalid_webhook_payload' })
    }

    const deliveryId = getString(request.headers['linear-delivery'])
    const eventType = getString(request.headers['linear-event'])

    if (!deliveryId || !eventType) {
      return reply.status(400).send({ error: 'missing_webhook_headers' })
    }

    if (!isSupportedLinearEventType(eventType)) {
      return reply.status(400).send({ error: 'unsupported_webhook_event' })
    }

    const providerTimestampMs = getNumber(payload.webhookTimestamp)
    const providerTimestamp =
      providerTimestampMs === null ? null : new Date(providerTimestampMs)
    const replayWindowValid = isReplayWindowValid(
      options.now?.() ?? new Date(),
      providerTimestamp,
      options.config.ingress.replayWindowMs,
    )
    const signatureStatus = verifyLinearSignature(
      options.config.ingress.linearWebhookSecret,
      rawBody,
      request.headers['linear-signature'],
    )

    if (signatureStatus !== 'verified' || !replayWindowValid) {
      request.log.warn(
        {
          deliveryId,
          eventType,
          signatureStatus,
          replayWindowValid,
        },
        'linear webhook failed edge validation and will be persisted for audit',
      )
    }

    const refs = deriveLinearRefs(payload, eventType)

    const persisted = await options.webhookIngressRepository.persistRawEventDelivery({
      provider: 'linear',
      providerEventType: eventType,
      providerAction: getString(payload.action),
      deliveryId,
      signatureStatus,
      providerTimestamp,
      requestHeaders: serializeHeaders(request.headers),
      rawBody,
      parsedPayload: payload,
      replayWindowValid,
      issueId: refs.issueId,
      commentId: refs.commentId,
      projectId: refs.projectId,
      repositoryFullName: refs.repositoryFullName,
    })

    return reply.status(202).send({
      accepted: true,
      duplicate: persisted.wasDuplicate,
    })
  })

  app.post('/github', async (request, reply) => {
    const payload = asJsonObject(request.body)
    const rawBody = request.rawBody

    if (!payload || typeof rawBody !== 'string') {
      return reply.status(400).send({ error: 'invalid_webhook_payload' })
    }

    const deliveryId = getString(request.headers['x-github-delivery'])
    const eventType = getString(request.headers['x-github-event'])

    if (!deliveryId || !eventType) {
      return reply.status(400).send({ error: 'missing_webhook_headers' })
    }

    if (!isSupportedGitHubEventType(eventType)) {
      return reply.status(400).send({ error: 'unsupported_webhook_event' })
    }

    const signatureStatus = verifyGitHubSignature(
      options.config.ingress.githubWebhookSecret,
      rawBody,
      request.headers['x-hub-signature-256'],
    )

    if (signatureStatus !== 'verified') {
      request.log.warn(
        {
          deliveryId,
          eventType,
          signatureStatus,
        },
        'github webhook failed edge validation and will be persisted for audit',
      )
    }

    const refs = deriveGitHubRefs(payload)

    const persisted = await options.webhookIngressRepository.persistRawEventDelivery({
      provider: 'github',
      providerEventType: eventType,
      providerAction: getString(payload.action),
      deliveryId,
      signatureStatus,
      providerTimestamp: null,
      requestHeaders: serializeHeaders(request.headers),
      rawBody,
      parsedPayload: payload,
      replayWindowValid: null,
      issueId: refs.issueId,
      commentId: refs.commentId,
      projectId: refs.projectId,
      repositoryFullName: refs.repositoryFullName,
    })

    return reply.status(202).send({
      accepted: true,
      duplicate: persisted.wasDuplicate,
    })
  })
}
