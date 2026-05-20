import type { FastifyPluginAsync } from 'fastify'

import type {
  DailyMetricsView,
  LifecycleCommandEnvelopeInput,
  LifecycleReadRepository,
  StuckIssueView,
  SystemHealthView,
} from '../lifecycle.js'
import {
  ACTOR_TYPES,
  ARTIFACT_SCOPES,
  type ActorType,
  type SharedJsonObject,
} from '@ai-dev-team/shared'

interface LifecycleRoutesOptions {
  lifecycleReadRepository: LifecycleReadRepository
}

const CANONICAL_LIFECYCLE_COMMAND_SOURCES = {
  ingestSystemCommand: 'operator_api',
  ingestTimerFired: 'system_timer',
  cancelOpenHumanGate: 'operator_api',
} as const

type CanonicalLifecycleCommandSignalName =
  keyof typeof CANONICAL_LIFECYCLE_COMMAND_SOURCES

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error(`Missing or invalid ${fieldName}`), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  return value.trim()
}

function requireOptionalString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  return value.trim()
}

function parseIsoTimestamp(value: unknown, fieldName: string): string {
  const timestamp = requireString(value, fieldName)

  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  const parsed = new Date(timestamp)

  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error(`Invalid ${fieldName}`), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  return parsed.toISOString()
}

function isActorType(value: unknown): value is ActorType {
  return typeof value === 'string' && ACTOR_TYPES.includes(value as ActorType)
}

function isCanonicalLifecycleCommandSignalName(
  value: unknown,
): value is CanonicalLifecycleCommandSignalName {
  return (
    typeof value === 'string' &&
    value in CANONICAL_LIFECYCLE_COMMAND_SOURCES
  )
}

function resolveCanonicalLifecycleCommandSource(
  signalName: CanonicalLifecycleCommandSignalName,
  source: string | null,
): string {
  const canonicalSource = CANONICAL_LIFECYCLE_COMMAND_SOURCES[signalName]
  const reservedSources = new Set([
    'comment_response_workflow',
    'workflow_internal',
  ])

  if (source !== null && reservedSources.has(source)) {
    throw Object.assign(
      new Error(
        `source ${source} is reserved for workflow-internal lifecycle commands`,
      ),
      {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      },
    )
  }

  return canonicalSource
}

function parseArtifacts(
  value: unknown,
): LifecycleCommandEnvelopeInput['artifacts'] {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw Object.assign(new Error('artifacts must be an array'), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw Object.assign(new Error(`artifacts[${index.toString()}] must be an object`), {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      })
    }

    const artifactScope = requireString(
      entry.artifactScope,
      `artifacts[${index.toString()}].artifactScope`,
    )

    if (!ARTIFACT_SCOPES.includes(artifactScope as (typeof ARTIFACT_SCOPES)[number])) {
      throw Object.assign(
        new Error(`artifacts[${index.toString()}].artifactScope is invalid`),
        {
          statusCode: 422,
          code: 'invalid_lifecycle_command',
        },
      )
    }

    return {
      artifactType: requireString(
        entry.artifactType,
        `artifacts[${index.toString()}].artifactType`,
      ),
      artifactScope: artifactScope as (typeof ARTIFACT_SCOPES)[number],
      artifactUri: requireString(
        entry.artifactUri,
        `artifacts[${index.toString()}].artifactUri`,
      ),
      artifactSummary: requireOptionalString(
        entry.artifactSummary,
        `artifacts[${index.toString()}].artifactSummary`,
      ),
      producedByRole: requireOptionalString(
        entry.producedByRole,
        `artifacts[${index.toString()}].producedByRole`,
      ),
      metadata: isRecord(entry.metadata)
        ? (entry.metadata as SharedJsonObject)
        : ({} as SharedJsonObject),
    }
  })
}

function parseCommandRequest(
  issueId: string,
  body: unknown,
): LifecycleCommandEnvelopeInput {
  if (!isRecord(body)) {
    throw Object.assign(new Error('Lifecycle command body must be an object'), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  const bodyIssueId = body.issueId

  if (bodyIssueId !== undefined && bodyIssueId !== issueId) {
    throw Object.assign(new Error('issueId does not match route parameter'), {
      statusCode: 422,
      code: 'invalid_lifecycle_command',
    })
  }

  const signalName =
    body.signalName === undefined
      ? 'ingestSystemCommand'
      : requireString(body.signalName, 'signalName')

  if (!isCanonicalLifecycleCommandSignalName(signalName)) {
    throw Object.assign(
      new Error(
        'Only ingestSystemCommand, ingestTimerFired, and cancelOpenHumanGate are allowed',
      ),
      {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      },
    )
  }

  const source = resolveCanonicalLifecycleCommandSource(
    signalName,
    requireOptionalString(body.source, 'source'),
  )

  const triggerCode = requireOptionalString(body.triggerCode, 'triggerCode')
  const allowedTriggerCodes = new Set([
    'human_status_change',
    'human_decision_given',
    'human_cancel',
    'system_block_cleared',
  ])

  if (
    signalName === 'ingestSystemCommand' &&
    (!triggerCode || !allowedTriggerCodes.has(triggerCode))
  ) {
    throw Object.assign(
      new Error(
        'triggerCode must be one of human_status_change, human_decision_given, human_cancel, system_block_cleared',
      ),
      {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      },
    )
  }

  const metadata = isRecord(body.metadata) ? body.metadata : {}
  const commandKey = requireString(body.commandKey, 'commandKey')
  const canonicalWorkflowId = `issue:${issueId}`
  const actorType =
    body.actorType === undefined
      ? signalName === 'ingestTimerFired' || triggerCode === 'system_block_cleared'
        ? 'system'
        : 'human'
      : isActorType(body.actorType)
        ? body.actorType
        : (() => {
            throw Object.assign(new Error('actorType must be one of human, system, agent'), {
              statusCode: 422,
              code: 'invalid_lifecycle_command',
            })
          })()

  const requestedStatusCode = requireOptionalString(
    body.requestedStatusCode,
    'requestedStatusCode',
  )
  const requiredRequestedStatusTriggers = new Set([
    'human_status_change',
    'human_decision_given',
    'system_block_cleared',
  ])

  if (
    signalName === 'ingestSystemCommand' &&
    triggerCode !== null &&
    requiredRequestedStatusTriggers.has(triggerCode) &&
    !requestedStatusCode
  ) {
    throw Object.assign(
      new Error(
        'requestedStatusCode is required for human_status_change, human_decision_given, and system_block_cleared',
      ),
      {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      },
    )
  }

  if (
    body.workflowId !== undefined &&
    requireString(body.workflowId, 'workflowId') !== canonicalWorkflowId
  ) {
    throw Object.assign(
      new Error('workflowId must be canonical for the issue route'),
      {
        statusCode: 422,
        code: 'invalid_lifecycle_command',
      },
    )
  }

  return {
    schemaVersion: 1,
    commandKey,
    issueId,
    workflowId: canonicalWorkflowId,
    signalName: signalName as LifecycleCommandEnvelopeInput['signalName'],
    source,
    sourceRef:
      body.sourceRef === undefined
        ? commandKey
        : requireString(body.sourceRef, 'sourceRef'),
    occurredAt:
      body.occurredAt === undefined
        ? new Date().toISOString()
        : parseIsoTimestamp(body.occurredAt, 'occurredAt'),
    actorType: actorType as ActorType,
    actorId:
      body.actorId === undefined
        ? 'control-api'
        : requireString(body.actorId, 'actorId'),
    canonicalEventId: requireOptionalString(body.canonicalEventId, 'canonicalEventId'),
    triggerCode,
    requestedStatusCode,
    commentId: requireOptionalString(body.commentId, 'commentId'),
    reasonCode: requireOptionalString(body.reasonCode, 'reasonCode'),
    reasonText: requireOptionalString(body.reasonText, 'reasonText'),
    checkpointId: requireOptionalString(body.checkpointId, 'checkpointId'),
    leaseId: requireOptionalString(body.leaseId, 'leaseId'),
    blockedByIssueIds: Array.isArray(body.blockedByIssueIds)
      ? body.blockedByIssueIds.filter((entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
        )
      : undefined,
    guardOutcomes: isRecord(body.guardOutcomes)
      ? (body.guardOutcomes as LifecycleCommandEnvelopeInput['guardOutcomes'])
      : undefined,
    artifacts: parseArtifacts(body.artifacts),
    metadata: metadata as NonNullable<LifecycleCommandEnvelopeInput['metadata']>,
  }
}

function parseDateQuery(date: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Query parameter date must be YYYY-MM-DD'), {
      statusCode: 400,
      code: 'invalid_metrics_date',
    })
  }

  return date
}

export const lifecycleRoutes: FastifyPluginAsync<LifecycleRoutesOptions> = async (
  app,
  options,
) => {
  app.post('/issues/:issueId/lifecycle-commands', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const envelope = parseCommandRequest(issueId, request.body)
    const persisted = await options.lifecycleReadRepository.persistLifecycleCommand(
      envelope,
    )

    return reply
      .status(persisted.wasDuplicate ? 200 : 201)
      .send(persisted)
  })

  app.get('/issues/:issueId/lifecycle-snapshot', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const snapshot = await options.lifecycleReadRepository.getLifecycleSnapshot(
      issueId,
    )

    if (!snapshot) {
      return reply.status(404).send({ error: 'lifecycle_snapshot_not_found' })
    }

    return snapshot
  })

  app.get('/issues/:issueId/journey', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const journey = await options.lifecycleReadRepository.getIssueJourney(issueId)

    if (!journey) {
      return reply.status(404).send({ error: 'issue_journey_not_found' })
    }

    return journey
  })

  app.get('/metrics/system-health', async (): Promise<SystemHealthView> => {
    return options.lifecycleReadRepository.getSystemHealth()
  })

  app.get('/metrics/stuck-issues', async (): Promise<StuckIssueView[]> => {
    return options.lifecycleReadRepository.getStuckIssues()
  })

  app.get('/metrics/daily', async (request): Promise<DailyMetricsView | void> => {
    const query = request.query as { date?: unknown }
    const date = parseDateQuery(query.date)

    return options.lifecycleReadRepository.getDailyMetrics(date)
  })
}
