import { setTimeout as delay } from 'node:timers/promises'

import type { FastifyPluginAsync } from 'fastify'

import type {
  RunnerArtifactStageRequestV1,
  RunnerAttemptCancelRequestV1,
  RunnerAttemptCompletionRequestV1,
  RunnerAttemptFailureRequestV1,
  RunnerExecutionStartedRequestV1,
  RunnerHeartbeatRequestV1,
  RunnerLeaseClaimRequestV1,
  RunnerManifestUpsertRequestV1,
} from '@ai-dev-team/shared'
import {
  AGENT_PROVIDERS,
  INTEGRATION_NETWORK_MODES,
  MCP_PROCESS_STATES,
  MCP_REUSE_POLICIES,
  MCP_SHARING_SCOPES,
  PROVIDER_FAILURE_CLASSES,
  PROVIDER_FALLBACK_REASONS,
  RUN_KINDS,
  RUNNER_CANCEL_OUTCOMES,
  RUNNER_SKILL_SYNC_STATUSES,
} from '@ai-dev-team/shared'
import type { JsonObject } from '@ai-dev-team/db'

import type { RunnerWriteRepository } from '../runners.js'

interface RunnerHostRoutesOptions {
  runnerWriteRepository: RunnerWriteRepository
  longPollMaxWaitMs: number
}

const schemaVersion1 = { type: 'number', const: 1 } as const
const schemaVersion2 = { type: 'number', const: 2 } as const
const requiredString = { type: 'string', minLength: 1 } as const
const nullableString = {
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
} as const
const genericObject = {
  type: 'object',
  additionalProperties: true,
} as const
const stringArray = {
  type: 'array',
  items: requiredString,
} as const
const providerStringSchema = {
  type: 'string',
  enum: [...AGENT_PROVIDERS],
} as const
const providerArraySchema = {
  type: 'array',
  items: providerStringSchema,
} as const
const runKindSchema = {
  type: 'string',
  enum: [...RUN_KINDS],
} as const
const integrationNetworkModesSchema = {
  type: 'array',
  items: {
    type: 'string',
    enum: [...INTEGRATION_NETWORK_MODES],
  },
} as const
const sessionCountsSchema = {
  type: 'object',
  additionalProperties: { type: 'number' },
} as const
const mcpBindingSchema = {
  type: 'object',
  required: ['serverName', 'sharingScope', 'bindingKey', 'reused', 'repoSlug'],
  additionalProperties: false,
  properties: {
    serverName: requiredString,
    sharingScope: { type: 'string', enum: [...MCP_SHARING_SCOPES] },
    bindingKey: requiredString,
    reused: { type: 'boolean' },
    repoSlug: nullableString,
  },
} as const
const mcpPoolBindingSnapshotSchema = {
  type: 'object',
  required: [
    'serverName',
    'sharingScope',
    'repoSlug',
    'bindingKey',
    'acquiredCount',
    'sessionCounts',
    'processState',
    'updatedAt',
  ],
  additionalProperties: false,
  properties: {
    serverName: requiredString,
    sharingScope: { type: 'string', enum: [...MCP_SHARING_SCOPES] },
    repoSlug: nullableString,
    bindingKey: requiredString,
    acquiredCount: { type: 'number' },
    sessionCounts: sessionCountsSchema,
    processState: { type: 'string', enum: [...MCP_PROCESS_STATES] },
    updatedAt: requiredString,
  },
} as const
const runnerMcpPoolSnapshotSchema = {
  type: 'object',
  required: ['schemaVersion', 'runnerNodeId', 'configHash', 'capturedAt', 'bindings'],
  additionalProperties: false,
  properties: {
    schemaVersion: schemaVersion1,
    runnerNodeId: requiredString,
    configHash: requiredString,
    capturedAt: requiredString,
    bindings: {
      type: 'array',
      items: mcpPoolBindingSnapshotSchema,
    },
  },
} as const
const leaseAttemptParamsSchema = {
  type: 'object',
  required: ['leaseAttemptId'],
  additionalProperties: false,
  properties: {
    leaseAttemptId: requiredString,
  },
} as const
const contextPackParamsSchema = {
  type: 'object',
  required: ['contextPackId'],
  additionalProperties: false,
  properties: {
    contextPackId: requiredString,
  },
} as const
const artifactParamsSchema = {
  type: 'object',
  required: ['artifactId'],
  additionalProperties: false,
  properties: {
    artifactId: requiredString,
  },
} as const
const releaseParamsSchema = {
  type: 'object',
  required: ['releaseId'],
  additionalProperties: false,
  properties: {
    releaseId: requiredString,
  },
} as const
const installedSkillBundleSchema = {
  type: 'object',
  required: ['releaseId', 'fingerprint', 'skillIds'],
  additionalProperties: false,
  properties: {
    releaseId: requiredString,
    fingerprint: requiredString,
    skillIds: stringArray,
  },
} as const
const manifestSchema = {
  type: 'object',
  required: [
    'runnerNodeId',
    'hostGroupId',
    'manifestVersion',
    'providers',
    'providerCliVersions',
    'supportedRoles',
    'supportedRunKinds',
    'supportedRepoKinds',
    'mcpServerCatalog',
    'toolBaseline',
    'skillsAvailable',
    'workspaceRoot',
    'worktreeRoot',
    'maxConcurrentLeases',
    'supportsInterrupt',
    'supportsCheckpointResume',
    'supportsArtifactUpload',
    'supportsConcurrentSessions',
    'integration',
    'host',
    'publishedAt',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: schemaVersion1,
    runnerNodeId: requiredString,
    hostGroupId: requiredString,
    manifestVersion: { type: 'number' },
    providers: providerArraySchema,
    providerCliVersions: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    supportedRoles: stringArray,
    supportedRunKinds: {
      type: 'array',
      items: runKindSchema,
    },
    supportedRepoKinds: stringArray,
    mcpServerCatalog: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'serverName',
          'sharingScope',
          'reusePolicy',
          'supportsConcurrentSessions',
          'configHash',
        ],
        additionalProperties: false,
        properties: {
          serverName: requiredString,
          sharingScope: { type: 'string', enum: [...MCP_SHARING_SCOPES] },
          reusePolicy: { type: 'string', enum: [...MCP_REUSE_POLICIES] },
          supportsConcurrentSessions: { type: 'boolean' },
          configHash: requiredString,
        },
      },
    },
    toolBaseline: stringArray,
    skillsAvailable: stringArray,
    activeAgentLibraryReleaseId: nullableString,
    activeAgentLibraryFingerprint: nullableString,
    skillSyncStatus: {
      anyOf: [
        { type: 'string', enum: [...RUNNER_SKILL_SYNC_STATUSES] },
        { type: 'null' },
      ],
    },
    skillSyncError: nullableString,
    installedSkillBundles: {
      type: 'array',
      items: installedSkillBundleSchema,
    },
    workspaceRoot: requiredString,
    worktreeRoot: requiredString,
    maxConcurrentLeases: { type: 'number' },
    supportsInterrupt: { type: 'boolean' },
    supportsCheckpointResume: { type: 'boolean' },
    supportsArtifactUpload: { type: 'boolean' },
    supportsConcurrentSessions: { type: 'boolean' },
    integration: {
      type: 'object',
      required: [
        'networkModesSupported',
        'allowedDocDomains',
        'allowedSandboxDomains',
        'supportsBrowserConsent',
        'supportsSecretBroker',
        'supportsOAuthBroker',
        'supportsIntegrationLab',
      ],
      additionalProperties: false,
      properties: {
        networkModesSupported: integrationNetworkModesSchema,
        allowedDocDomains: stringArray,
        allowedSandboxDomains: stringArray,
        supportsBrowserConsent: { type: 'boolean' },
        supportsSecretBroker: { type: 'boolean' },
        supportsOAuthBroker: { type: 'boolean' },
        supportsIntegrationLab: { type: 'boolean' },
      },
    },
    host: {
      type: 'object',
      required: ['hostName', 'hostOs', 'hostArch'],
      additionalProperties: false,
      properties: {
        hostName: requiredString,
        hostOs: requiredString,
        hostArch: requiredString,
      },
    },
    publishedAt: requiredString,
  },
} as const
const manifestRequestSchema = {
  body: {
    type: 'object',
    required: ['schemaVersion', 'manifest'],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      manifest: manifestSchema,
    },
  },
} as const
const claimRequestSchema = {
  body: {
    type: 'object',
    required: ['schemaVersion', 'runnerNodeId', 'heartbeatExpiryAt'],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      heartbeatExpiryAt: requiredString,
    },
  },
} as const
const executionStartedSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: [
      'schemaVersion',
      'runnerNodeId',
      'leaseAttemptId',
      'executionSessionKey',
      'mcpBindingsSummary',
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      leaseAttemptId: requiredString,
      executionSessionKey: requiredString,
      mcpBindingsSummary: {
        type: 'array',
        items: mcpBindingSchema,
      },
    },
  },
} as const
const heartbeatSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: ['schemaVersion', 'runnerNodeId', 'leaseAttemptId', 'heartbeatExpiryAt'],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      leaseAttemptId: requiredString,
      heartbeatExpiryAt: requiredString,
      mcpPoolSnapshot: {
        anyOf: [runnerMcpPoolSnapshotSchema, { type: 'null' }],
      },
    },
  },
} as const
const artifactStageSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: [
      'schemaVersion',
      'runnerNodeId',
      'leaseAttemptId',
      'artifactKey',
      'contentType',
      'contentBase64',
      'metadata',
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      leaseAttemptId: requiredString,
      artifactKey: requiredString,
      contentType: requiredString,
      contentBase64: requiredString,
      metadata: genericObject,
    },
  },
} as const
const executionMetadataSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'agentRole',
    'promptVersion',
    'agentLibraryReleaseId',
    'taskInstructionsRef',
    'roleCharterRef',
    'promptBundleFingerprint',
    'resolvedPromptFamilyRefs',
    'skillPackRefs',
    'resolvedSkillRefs',
    'skippedOptionalSkillRefs',
    'effectiveSkillFingerprint',
    'contextPackFingerprint',
    'configVersion',
    'workflowId',
    'workflowRunId',
    'runKind',
    'attemptNo',
    'requestedProvider',
    'effectiveProvider',
    'providerAttemptNo',
    'fallbackFromProvider',
    'fallbackReason',
    'toolsUsed',
    'mcpBindings',
    'runnerNodeId',
    'hostGroupId',
    'executionDurationMs',
    'completionReason',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: schemaVersion2,
    agentRole: requiredString,
    promptVersion: requiredString,
    agentLibraryReleaseId: nullableString,
    taskInstructionsRef: nullableString,
    roleCharterRef: nullableString,
    promptBundleFingerprint: nullableString,
    resolvedPromptFamilyRefs: stringArray,
    skillPackRefs: stringArray,
    resolvedSkillRefs: stringArray,
    skippedOptionalSkillRefs: stringArray,
    effectiveSkillFingerprint: nullableString,
    contextPackFingerprint: nullableString,
    reviewedBuildArtifactId: nullableString,
    configVersion: { type: 'number' },
    workflowId: requiredString,
    workflowRunId: nullableString,
    runKind: {
      anyOf: [{ type: 'string', enum: [...RUN_KINDS] }, { type: 'null' }],
    },
    attemptNo: { type: 'number' },
    requestedProvider: {
      anyOf: [{ type: 'string', enum: [...AGENT_PROVIDERS] }, { type: 'null' }],
    },
    effectiveProvider: {
      anyOf: [{ type: 'string', enum: [...AGENT_PROVIDERS] }, { type: 'null' }],
    },
    providerAttemptNo: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    fallbackFromProvider: {
      anyOf: [{ type: 'string', enum: [...AGENT_PROVIDERS] }, { type: 'null' }],
    },
    fallbackReason: {
      anyOf: [
        { type: 'string', enum: [...PROVIDER_FALLBACK_REASONS] },
        { type: 'null' },
      ],
    },
    toolsUsed: stringArray,
    mcpBindings: { type: 'array', items: mcpBindingSchema },
    runnerNodeId: nullableString,
    hostGroupId: nullableString,
    executionDurationMs: { type: 'number' },
    completionReason: requiredString,
  },
} as const
const nullableExecutionMetadataSchema = {
  anyOf: [executionMetadataSchema, { type: 'null' }],
} as const
const completionSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: ['schemaVersion', 'runnerNodeId', 'artifactBundle', 'executionMetadata'],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      artifactBundle: {
        type: 'object',
        required: [
          'schemaVersion',
          'leaseId',
          'leaseAttemptId',
          'issueId',
          'runId',
          'requestedProvider',
          'effectiveProvider',
          'providerAttemptNo',
          'fallbackFromProvider',
          'fallbackReason',
          'roleExecutionPolicyVersion',
          'agentRole',
          'status',
          'summary',
          'changedFiles',
          'testResults',
          'patchRef',
          'branchRef',
          'reviewFindings',
          'executionSessionKey',
          'mcpProfileRef',
          'mcpBindingsSummary',
          'toolUsage',
          'mcpBindings',
          'providerExecutionMetadata',
          'producedAt',
        ],
        additionalProperties: false,
        properties: {
          schemaVersion: schemaVersion2,
          leaseId: requiredString,
          leaseAttemptId: requiredString,
          issueId: requiredString,
          requestedProvider: { type: 'string', enum: [...AGENT_PROVIDERS] },
          effectiveProvider: { type: 'string', enum: [...AGENT_PROVIDERS] },
          providerAttemptNo: { type: 'number' },
          fallbackFromProvider: {
            anyOf: [{ type: 'string', enum: [...AGENT_PROVIDERS] }, { type: 'null' }],
          },
          fallbackReason: {
            anyOf: [
              { type: 'string', enum: [...PROVIDER_FALLBACK_REASONS] },
              { type: 'null' },
            ],
          },
          runId: nullableString,
          roleExecutionPolicyVersion: { type: 'number' },
          agentRole: requiredString,
          runKind: {
            anyOf: [{ type: 'string', enum: [...RUN_KINDS] }, { type: 'null' }],
          },
          status: {
            type: 'string',
            enum: ['completed', 'failed', 'canceled', 'no_output'],
          },
          summary: nullableString,
          changedFiles: stringArray,
          testResults: { type: 'array', items: genericObject },
          patchRef: nullableString,
          branchRef: nullableString,
          reviewFindings: { type: 'array', items: genericObject },
          reviewDisposition: {
            anyOf: [
              {
                type: 'string',
                enum: [
                  'human_gate_required',
                  'rework_recommended',
                  'review_inconclusive',
                ],
              },
              { type: 'null' },
            ],
          },
          decisionSummary: nullableString,
          recommendedNextAction: nullableString,
          reviewedBuildArtifactId: nullableString,
          executionSessionKey: requiredString,
          mcpProfileRef: requiredString,
          mcpBindingsSummary: { type: 'array', items: mcpBindingSchema },
          toolUsage: stringArray,
          mcpBindings: { type: 'array', items: mcpBindingSchema },
          providerExecutionMetadata: genericObject,
          producedAt: requiredString,
        },
      },
      executionMetadata: {
        ...executionMetadataSchema,
      },
    },
  },
} as const
const failureSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: [
      'schemaVersion',
      'runnerNodeId',
      'leaseAttemptId',
      'errorClass',
      'errorMessage',
      'fallbackReason',
      'checkpointRef',
      'supportsCheckpointResume',
      'executionMetadata',
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      leaseAttemptId: requiredString,
      errorClass: { type: 'string', enum: [...PROVIDER_FAILURE_CLASSES] },
      errorMessage: requiredString,
      fallbackReason: {
        anyOf: [
          { type: 'string', enum: [...PROVIDER_FALLBACK_REASONS] },
          { type: 'null' },
        ],
      },
      checkpointRef: nullableString,
      supportsCheckpointResume: { type: 'boolean' },
      executionMetadata: nullableExecutionMetadataSchema,
    },
  },
} as const
const cancelSchema = {
  params: leaseAttemptParamsSchema,
  body: {
    type: 'object',
    required: ['schemaVersion', 'runnerNodeId', 'leaseAttemptId', 'outcome', 'checkpointRef'],
    additionalProperties: false,
    properties: {
      schemaVersion: schemaVersion1,
      runnerNodeId: requiredString,
      leaseAttemptId: requiredString,
      outcome: { type: 'string', enum: [...RUNNER_CANCEL_OUTCOMES] },
      checkpointRef: nullableString,
    },
  },
} as const

function assertRunnerIdentity(
  authenticatedRunnerNodeId: string | undefined,
  payloadRunnerNodeId: string,
): void {
  if (!authenticatedRunnerNodeId || authenticatedRunnerNodeId !== payloadRunnerNodeId) {
    const error = new Error('Runner token does not match payload runnerNodeId')
    ;(error as Error & { statusCode?: number; code?: string }).statusCode = 403
    ;(error as Error & { statusCode?: number; code?: string }).code =
      'runner_identity_mismatch'
    throw error
  }
}

function assertLeaseAttemptParam(
  paramLeaseAttemptId: string,
  payloadLeaseAttemptId: string,
): void {
  if (paramLeaseAttemptId !== payloadLeaseAttemptId) {
    const error = new Error('leaseAttemptId path parameter does not match request body')
    ;(error as Error & { statusCode?: number; code?: string }).statusCode = 400
    ;(error as Error & { statusCode?: number; code?: string }).code =
      'lease_attempt_mismatch'
    throw error
  }
}

function replyWithRunnerReadError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown {
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'runner_host_read_failed'
  const message =
    error instanceof Error ? error.message : 'Unexpected runner-host read failure'

  return reply.status(statusCode).send({
    error: code,
    message,
  })
}

export const runnerHostRoutes: FastifyPluginAsync<RunnerHostRoutesOptions> = async (
  app,
  options,
) => {
  app.put('/manifests/current', { schema: manifestRequestSchema }, async (request) => {
    const body = request.body as RunnerManifestUpsertRequestV1
    assertRunnerIdentity(
      request.authenticatedRunnerNodeId,
      body.manifest.runnerNodeId,
    )

    return options.runnerWriteRepository.upsertManifest({
      request: body,
      authSubject: `runner-host:${request.authenticatedRunnerNodeId}`,
    })
  })

  app.post('/leases:claim-next', { schema: claimRequestSchema }, async (request) => {
    const body = request.body as RunnerLeaseClaimRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)

    const deadline = Date.now() + options.longPollMaxWaitMs
    let requestClosed = false
    let resolveRequestClosed: (() => void) | null = null
    const requestClosedPromise = new Promise<void>((resolve) => {
      resolveRequestClosed = resolve
    })
    const handleClose = () => {
      requestClosed = true
      resolveRequestClosed?.()
    }
    request.raw.once('close', handleClose)
    let response = await options.runnerWriteRepository.claimNextTask(body)

    while (!requestClosed && !response.task && Date.now() < deadline) {
      const waitMs = Math.min(500, Math.max(deadline - Date.now(), 0))

      if (waitMs <= 0) {
        break
      }

      await Promise.race([delay(waitMs), requestClosedPromise])
      if (requestClosed) {
        break
      }
      response = await options.runnerWriteRepository.claimNextTask(body)
    }

    request.raw.off('close', handleClose)
    return response
  })

  app.get('/context-packs/:contextPackId', { schema: { params: contextPackParamsSchema } }, async (request, reply) => {
    const { contextPackId } = request.params as { contextPackId: string }
    const resource =
      await options.runnerWriteRepository.getContextPackResource(contextPackId)

    if (!resource) {
      return reply.status(404).send({ error: 'context_pack_not_found' })
    }

    return resource
  })

  app.get('/artifacts/:artifactId', { schema: { params: artifactParamsSchema } }, async (request, reply) => {
    const { artifactId } = request.params as { artifactId: string }
    const resource =
      await options.runnerWriteRepository.getArtifactResource(artifactId)

    if (!resource) {
      return reply.status(404).send({ error: 'artifact_not_found' })
    }

    return resource
  })

  app.get(
    '/attempts/:leaseAttemptId/execution-bundle',
    { schema: { params: leaseAttemptParamsSchema } },
    async (request, reply) => {
      const { leaseAttemptId } = request.params as { leaseAttemptId: string }

      try {
        const resource =
          await options.runnerWriteRepository.getExecutionBundle(leaseAttemptId)
        return reply.send(resource)
      } catch (error) {
        return replyWithRunnerReadError(reply, error)
      }
    },
  )

  app.get(
    '/skill-sync/active-release',
    async (_request, reply) => {
      const resource =
        await options.runnerWriteRepository.getActiveSkillReleaseSummary()

      return reply.send(resource)
    },
  )

  app.get(
    '/skill-sync/releases/:releaseId',
    { schema: { params: releaseParamsSchema } },
    async (request, reply) => {
      const { releaseId } = request.params as { releaseId: string }
      const resource =
        await options.runnerWriteRepository.getSkillReleasePayload(releaseId)

      if (!resource) {
        return reply.status(404).send({ error: 'skill_release_not_found' })
      }

      return reply.send(resource)
    },
  )

  app.post(
    '/attempts/:leaseAttemptId/execution-started',
    { schema: executionStartedSchema },
    async (request, reply) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerExecutionStartedRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(params.leaseAttemptId, body.leaseAttemptId)

    await options.runnerWriteRepository.markExecutionStarted(body)
    return reply.status(204).send()
    },
  )

  app.post('/attempts/:leaseAttemptId/heartbeat', { schema: heartbeatSchema }, async (request) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerHeartbeatRequestV1 & {
      mcpPoolSnapshot?: JsonObject | null
    }
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(params.leaseAttemptId, body.leaseAttemptId)

    return options.runnerWriteRepository.heartbeat(body)
  })

  app.post('/attempts/:leaseAttemptId/artifacts', { schema: artifactStageSchema }, async (request) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerArtifactStageRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(params.leaseAttemptId, body.leaseAttemptId)

    return options.runnerWriteRepository.stageArtifact(body)
  })

  app.post('/attempts/:leaseAttemptId/completed', { schema: completionSchema }, async (request, reply) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerAttemptCompletionRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(
      params.leaseAttemptId,
      body.artifactBundle.leaseAttemptId,
    )

    await options.runnerWriteRepository.completeAttempt(body)
    return reply.status(204).send()
  })

  app.post('/attempts/:leaseAttemptId/failed', { schema: failureSchema }, async (request, reply) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerAttemptFailureRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(params.leaseAttemptId, body.leaseAttemptId)

    await options.runnerWriteRepository.failAttempt(body)
    return reply.status(204).send()
  })

  app.post('/attempts/:leaseAttemptId/cancel', { schema: cancelSchema }, async (request) => {
    const params = request.params as { leaseAttemptId: string }
    const body = request.body as RunnerAttemptCancelRequestV1
    assertRunnerIdentity(request.authenticatedRunnerNodeId, body.runnerNodeId)
    assertLeaseAttemptParam(params.leaseAttemptId, body.leaseAttemptId)

    return options.runnerWriteRepository.acknowledgeCancellation(body)
  })
}
