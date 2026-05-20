import { timingSafeEqual } from 'node:crypto'

import Fastify, { type FastifyInstance } from 'fastify'

import type { ControlApiConfig } from '@ai-dev-team/config'
import type {
  PersistRawEventDeliveryInput,
  PersistRawEventDeliveryResult,
} from '@ai-dev-team/db'
import type {
  BlockedIssueProjectionView,
  IssueLinearSyncProjectionView,
  IssueRuntimeStateView,
  StatusProjectionView,
  WorkflowConfigSummary,
} from '@ai-dev-team/shared'

import type { KnowledgeReadRepository } from './knowledge.js'
import type { LifecycleReadRepository } from './lifecycle.js'
import type { IntegrationReadRepository, IntegrationWriteRepository } from './integrations.js'
import type { RunnerReadRepository, RunnerWriteRepository } from './runners.js'
import { integrationRoutes } from './routes/integrations.js'
import { integrationWriteRoutes } from './routes/integration-writes.js'
import { lifecycleRoutes } from './routes/lifecycle.js'
import { knowledgeRoutes } from './routes/knowledge.js'
import { runnerHostRoutes } from './routes/runner-host.js'
import { runnerRoutes } from './routes/runners.js'
import { systemRoutes } from './routes/system.js'
import { webhookRoutes } from './routes/webhooks.js'
import { workflowRoutes } from './routes/workflow.js'

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedRunnerNodeId?: string
  }
}

export interface WorkflowReadRepository {
  getActiveWorkflowConfig(): Promise<WorkflowConfigSummary | null>
  getIssueRuntimeState(issueId: string): Promise<IssueRuntimeStateView | null>
  getStatusProjection(issueId: string): Promise<StatusProjectionView | null>
  getIssueLinearSyncProjection(
    issueId: string,
  ): Promise<IssueLinearSyncProjectionView | null>
  getBlockedIssueProjection(
    issueId: string,
  ): Promise<BlockedIssueProjectionView | null>
}

export interface ControlApiDependencies {
  config: ControlApiConfig
  workflowReadRepository: WorkflowReadRepository
  knowledgeReadRepository: KnowledgeReadRepository
  lifecycleReadRepository: LifecycleReadRepository
  runnerReadRepository: RunnerReadRepository
  runnerWriteRepository: RunnerWriteRepository
  integrationReadRepository: IntegrationReadRepository
  integrationWriteRepository: IntegrationWriteRepository
  webhookIngressRepository: WebhookIngressRepository
  webhookNow?: () => Date
}

export interface WebhookIngressRepository {
  persistRawEventDelivery(
    input: PersistRawEventDeliveryInput,
  ): Promise<PersistRawEventDeliveryResult>
}

function isInternalRequest(pathname: string): boolean {
  return pathname.startsWith('/internal') && pathname !== '/internal/healthz'
}

function isRunnerHostRequest(pathname: string): boolean {
  return pathname.startsWith('/runner-host')
}

function isValidBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith('Bearer ')) {
    return false
  }

  const presentedToken = authorization.slice('Bearer '.length).trim()

  if (presentedToken.length === 0) {
    return false
  }

  const presentedBuffer = Buffer.from(presentedToken)
  const expectedBuffer = Buffer.from(expectedToken)

  if (presentedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(presentedBuffer, expectedBuffer)
}

function resolveRunnerNodeIdFromBearerToken(
  authorization: string | undefined,
  authTokensByNodeId: Record<string, string>,
): string | null {
  for (const [runnerNodeId, token] of Object.entries(authTokensByNodeId)) {
    if (isValidBearerToken(authorization, token)) {
      return runnerNodeId
    }
  }

  return null
}

export function createApp({
  config,
  workflowReadRepository,
  knowledgeReadRepository,
  lifecycleReadRepository,
  runnerReadRepository,
  runnerWriteRepository,
  integrationReadRepository,
  integrationWriteRepository,
  webhookIngressRepository,
  webhookNow,
}: ControlApiDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    bodyLimit: config.ingress.maxPayloadBytes,
  })

  app.addHook('onRequest', async (request, reply) => {
    const pathname = new URL(request.raw.url ?? request.url, 'http://localhost')
      .pathname

    if (!isInternalRequest(pathname)) {
      if (!isRunnerHostRequest(pathname)) {
        return
      }

      const authenticatedRunnerNodeId = resolveRunnerNodeIdFromBearerToken(
        request.headers.authorization,
        config.runner.authTokensByNodeId,
      )

      if (!authenticatedRunnerNodeId) {
        return reply
          .status(401)
          .header('WWW-Authenticate', 'Bearer')
          .send({
            error: 'unauthorized',
            message: 'Missing or invalid runner bearer token',
          })
      }

      request.authenticatedRunnerNodeId = authenticatedRunnerNodeId
      return
    }

    if (!isValidBearerToken(request.headers.authorization, config.internalApiBearerToken)) {
      return reply
        .status(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({
          error: 'unauthorized',
          message: 'Missing or invalid internal API bearer token',
        })
    }
  })

  app.setErrorHandler((error, request, reply) => {
    const errorDetails = error as {
      statusCode?: unknown
      code?: unknown
      message?: unknown
    }
    const statusCode =
      typeof errorDetails.statusCode === 'number' &&
      Number.isInteger(errorDetails.statusCode) &&
      errorDetails.statusCode >= 400 &&
      errorDetails.statusCode <= 599
        ? errorDetails.statusCode
        : 500

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed')
    } else {
      request.log.warn({ err: error }, 'request rejected')
    }

    if (!reply.sent) {
      void reply.status(statusCode).send(
        statusCode === 500
          ? {
              error: 'internal_server_error',
              message: 'Unexpected error',
            }
          : {
              error:
                statusCode === 413
                  ? 'payload_too_large'
                  : typeof errorDetails.code === 'string'
                    ? errorDetails.code
                    : 'bad_request',
              message:
                statusCode === 413
                  ? 'Request body is too large'
                  : typeof errorDetails.message === 'string'
                    ? errorDetails.message
                    : 'Bad request',
            },
      )
    }
  })

  app.register(systemRoutes, {
    prefix: '/internal',
    config,
  })

  app.register(workflowRoutes, {
    prefix: '/internal',
    workflowReadRepository,
  })

  app.register(knowledgeRoutes, {
    prefix: '/internal',
    knowledgeReadRepository,
  })

  app.register(lifecycleRoutes, {
    prefix: '/internal',
    lifecycleReadRepository,
  })

  app.register(runnerRoutes, {
    prefix: '/internal',
    runnerReadRepository,
    runnerWriteRepository,
  })

  app.register(runnerHostRoutes, {
    prefix: '/runner-host',
    longPollMaxWaitMs: config.runner.longPollMaxWaitMs,
    runnerWriteRepository,
  })

  app.register(integrationRoutes, {
    integrationReadRepository,
    oauthCallbackPathPrefix:
      config.integration.oauthService.defaultRedirectPathPrefix,
  })

  app.register(integrationWriteRoutes, {
    integrationWriteRepository,
  })

  app.register(webhookRoutes, {
    prefix: '/webhooks',
    config,
    webhookIngressRepository,
    now: webhookNow,
  })

  return app
}
