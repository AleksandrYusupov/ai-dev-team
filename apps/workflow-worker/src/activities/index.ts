import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import {
  buildAgentExecutionMetadataArtifact,
  createDb,
  getIssueRuntimeStateView,
  markLifecycleCommandAccepted,
  markLifecycleCommandRejected,
  refreshAgentMetricsDaily,
  type DbClient,
  type JsonObject,
} from '@ai-dev-team/db'
import type {
  AgentExecutionMetadataV2,
  LifecycleCommandEnvelopeV1,
  LifecycleCommandResultV1,
  RunKind,
} from '@ai-dev-team/shared'

import { applyTransition, bootstrapIssueRuntimeState } from '../application/workflow/apply-transition.js'

let dbSingleton: DbClient | null = null

function getDb(): DbClient {
  if (dbSingleton) {
    return dbSingleton
  }

  const config = loadWorkflowWorkerConfig(process.env)
  dbSingleton = createDb(config.database)
  return dbSingleton
}

function buildLifecycleCommandResult(input: {
  command: LifecycleCommandEnvelopeV1
  status: LifecycleCommandResultV1['status']
  transitionAuditId: string | null
  fromStatusCode: string | null
  toStatusCode: string | null
  activeRunId: string | null
  validatorError?: LifecycleCommandResultV1['validatorError']
  intentPersistedOnly: boolean
  completionReason: string
  metadata?: LifecycleCommandResultV1['metadata']
}): LifecycleCommandResultV1 {
  return {
    schemaVersion: 1,
    commandKey: input.command.commandKey,
    issueId: input.command.issueId,
    workflowId: input.command.workflowId,
    status: input.status,
    transitionAuditId: input.transitionAuditId,
    fromStatusCode: input.fromStatusCode,
    toStatusCode: input.toStatusCode,
    activeRunId: input.activeRunId,
    validatorError: input.validatorError ?? null,
    intentPersistedOnly: input.intentPersistedOnly,
    completionReason: input.completionReason,
    processedAt: new Date().toISOString(),
    metadata: input.metadata ?? {},
  }
}

function extractConfigVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function buildCommentResponseWorkflowId(command: LifecycleCommandEnvelopeV1): string {
  return `comment-response:${command.commentId ?? command.commandKey}`
}

function resolveCommentResponseTargetStatus(
  command: LifecycleCommandEnvelopeV1,
  suspendedFromStatusCode: string | null,
): string {
  if (
    typeof command.requestedStatusCode === 'string' &&
    command.requestedStatusCode.trim().length > 0
  ) {
    return command.requestedStatusCode.trim()
  }

  if (
    suspendedFromStatusCode === 'needs_spec' ||
    suspendedFromStatusCode === 'planned' ||
    suspendedFromStatusCode === 'ready_for_build' ||
    suspendedFromStatusCode === 'coding' ||
    suspendedFromStatusCode === 'agent_review'
  ) {
    return suspendedFromStatusCode
  }

  return command.guardOutcomes?.contract_complete_enough_for_planning === true
    ? 'planned'
    : 'needs_spec'
}

export async function ensureIssueBootstrappedFromCommand(
  command: LifecycleCommandEnvelopeV1,
): Promise<LifecycleCommandResultV1> {
  const db = getDb()
  const existingState = await db
    .selectFrom('issue_runtime_state')
    .select(['current_status_code'])
    .where('issue_id', '=', command.issueId)
    .executeTakeFirst()

  if (existingState) {
    return buildLifecycleCommandResult({
      command,
      status: 'duplicate',
      transitionAuditId: null,
      fromStatusCode: existingState.current_status_code,
      toStatusCode: existingState.current_status_code,
      activeRunId: null,
      intentPersistedOnly: true,
      completionReason: 'issue_already_bootstrapped',
    })
  }

  const bootstrap = await bootstrapIssueRuntimeState(db, {
    issueId: command.issueId,
    workflowId: command.workflowId,
    actorId: command.actorId,
    rawIssueArtifactUri:
      typeof command.metadata.payloadRef === 'string'
        ? command.metadata.payloadRef
        : undefined,
    metadata: command.metadata,
  })

  return buildLifecycleCommandResult({
    command,
    status: 'accepted',
    transitionAuditId: bootstrap.transitionAuditId,
    fromStatusCode: null,
    toStatusCode: 'triage',
    activeRunId: null,
    intentPersistedOnly: false,
    completionReason: 'issue_bootstrapped',
    metadata: {
      configVersion: bootstrap.configVersion,
    },
  })
}

export async function applyLifecycleTransitionFromCommand(
  command: LifecycleCommandEnvelopeV1,
): Promise<LifecycleCommandResultV1> {
  const db = getDb()

  try {
    const result = await applyTransition(db, {
      issueId: command.issueId,
      triggerCode: command.triggerCode ?? '',
      requestedStatusCode: command.requestedStatusCode ?? null,
      actorType: command.actorType,
      actorId: command.actorId,
      reasonCode: command.reasonCode ?? null,
      reasonText: command.reasonText ?? null,
      commentId: command.commentId ?? null,
      checkpointId: command.checkpointId ?? null,
      leaseId: command.leaseId ?? null,
      blockedByIssueIds: command.blockedByIssueIds ?? [],
      guardOutcomes: command.guardOutcomes ?? {},
      artifacts: command.artifacts ?? [],
      metadata: command.metadata,
    })

    return buildLifecycleCommandResult({
      command,
      status: 'accepted',
      transitionAuditId: result.transitionAuditId,
      fromStatusCode: result.fromStatus,
      toStatusCode: result.toStatus,
      activeRunId: result.activeRunId,
      intentPersistedOnly: false,
      completionReason: 'transition_applied',
      metadata: {
        configVersion: result.configVersion,
        openOperatorQuestionId: result.openOperatorQuestionId,
        activeTimerIntents: result.activeTimerIntents.map((timerIntent) => ({
          timerKey: timerIntent.timerKey,
          dueAt: timerIntent.dueAt,
          reason: timerIntent.reason,
        })),
        outboxCommandCount: result.outboxCommandCount,
      },
    })
  } catch (error) {
    const details = error as {
      validatorError?: LifecycleCommandResultV1['validatorError']
      message?: string
    }

    if (details.validatorError) {
      return buildLifecycleCommandResult({
        command,
        status: 'rejected',
        transitionAuditId: null,
        fromStatusCode: null,
        toStatusCode: null,
        activeRunId: null,
        validatorError: details.validatorError,
        intentPersistedOnly: false,
        completionReason: 'transition_rejected',
      })
    }

    throw error
  }
}

export async function acceptLifecycleCommandActivity(input: {
  commandKey: string
  transitionAuditId: string | null
  resultPayload?: LifecycleCommandResultV1 | null
}): Promise<void> {
  const db = getDb()

  await markLifecycleCommandAccepted(db, {
    commandKey: input.commandKey,
    transitionAuditId: input.transitionAuditId,
    resultPayload:
      input.resultPayload?.status === 'duplicate'
        ? (input.resultPayload as unknown as JsonObject)
        : null,
  })
  await refreshAgentMetricsDaily(db, new Date())
}

export async function rejectLifecycleCommandActivity(input: {
  commandKey: string
  validatorPayload: LifecycleCommandResultV1['validatorError']
  errorMessage: string
}): Promise<void> {
  const db = getDb()

  await markLifecycleCommandRejected(db, {
    commandKey: input.commandKey,
    validatorPayload:
      (input.validatorPayload as unknown as JsonObject | null) ?? {},
    errorMessage: input.errorMessage,
  })
  await refreshAgentMetricsDaily(db, new Date())
}

export async function emitAgentExecutionMetadataActivity(input: {
  issueId: string
  transitionAuditId: string | null
  runId: string | null
  producedForStatusCode: string | null
  metadata: Omit<AgentExecutionMetadataV2, 'configVersion'> & {
    configVersion?: number | null
  }
}): Promise<void> {
  const db = getDb()
  let runKind = input.metadata.runKind
  let configVersion = extractConfigVersion(input.metadata.configVersion)

  if (!runKind && input.runId) {
    const run = await db
      .selectFrom('issue_runs')
      .select('run_kind')
      .where('id', '=', input.runId)
      .executeTakeFirst()

    runKind = run?.run_kind ?? null
  }

  if (configVersion === null && input.transitionAuditId) {
    const transition = await db
      .selectFrom('status_transition_audit')
      .select('config_version')
      .where('id', '=', input.transitionAuditId)
      .executeTakeFirst()

    configVersion = transition?.config_version ?? null
  }

  if (configVersion === null) {
    const runtimeState = await getIssueRuntimeStateView(db, input.issueId)

    configVersion = runtimeState?.pinnedConfigVersion ?? null
  }

  if (configVersion === null) {
    const latestTransition = await db
      .selectFrom('status_transition_audit')
      .select('config_version')
      .where('issue_id', '=', input.issueId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    configVersion = latestTransition?.config_version ?? null
  }

  const artifact = buildAgentExecutionMetadataArtifact({
    ...input.metadata,
    configVersion: configVersion ?? 1,
    runKind,
    issueId: input.issueId,
    transitionAuditId: input.transitionAuditId,
    runId: input.runId,
    producedForStatusCode: input.producedForStatusCode,
  })

  await db
    .insertInto('artifact_registry')
    .values({
      ...artifact,
      metadata: artifact.metadata as unknown as JsonObject,
    })
    .execute()
}

export async function prepareCommentResponseCommandActivity(input: {
  command: LifecycleCommandEnvelopeV1
}): Promise<{
  command: LifecycleCommandEnvelopeV1 | null
  completionReason: string
  configVersion: number | null
  runKind: RunKind | null
}> {
  const db = getDb()
  const runtimeState = await getIssueRuntimeStateView(db, input.command.issueId)
  const fallbackConfigVersion =
    extractConfigVersion(input.command.metadata.configVersion) ?? null

  if (!runtimeState) {
    return {
      command: null,
      completionReason: 'issue_runtime_state_missing',
      configVersion: fallbackConfigVersion,
      runKind: null,
    }
  }

  if (runtimeState.currentStatusCode !== 'needs_input') {
    return {
      command: null,
      completionReason: 'issue_not_waiting_for_input',
      configVersion: runtimeState.pinnedConfigVersion,
      runKind: null,
    }
  }

  if (!runtimeState.openOperatorQuestionId) {
    return {
      command: null,
      completionReason: 'open_operator_question_missing',
      configVersion: runtimeState.pinnedConfigVersion,
      runKind: null,
    }
  }

  const commentBody = input.command.commentId
    ? await db
        .selectFrom('comment_log')
        .select('body_markdown')
        .where('issue_id', '=', input.command.issueId)
        .where('provider_comment_id', '=', input.command.commentId)
        .executeTakeFirst()
    : null

  const artifactSummary = input.command.commentId
    ? `Updated issue contract from comment ${input.command.commentId}`
    : 'Updated issue contract from human input'
  const commentBodyExcerpt =
    typeof commentBody?.body_markdown === 'string'
      ? commentBody.body_markdown.slice(0, 500)
      : null
  const requestedStatusCode = resolveCommentResponseTargetStatus(
    input.command,
    runtimeState.suspendedFromStatusCode,
  )
  const artifactType =
    requestedStatusCode === 'needs_spec'
      ? 'updated_issue_contract_draft'
      : 'updated_issue_contract_snapshot'

  return {
    command: {
      ...input.command,
      schemaVersion: 1,
      commandKey: `${input.command.commandKey}:comment-response`,
      workflowId: runtimeState.workflowId,
      signalName: 'ingestSystemCommand',
      source: 'comment_response_workflow',
      sourceRef: input.command.commentId ?? input.command.commandKey,
      occurredAt: new Date().toISOString(),
      requestedStatusCode,
      guardOutcomes: {
        ...(input.command.guardOutcomes ?? {}),
        open_operator_question_present: true,
        answer_resolves_question: true,
        ...(requestedStatusCode !== 'needs_spec'
          ? {
              contract_complete_enough_for_planning: true,
              spec_loop_still_required: false,
            }
          : {
              spec_loop_still_required: true,
            }),
      },
      artifacts: [
        {
          artifactType,
          artifactScope: 'issue',
          artifactUri:
            input.command.commentId !== null && input.command.commentId !== undefined
              ? `linear-comment://${input.command.commentId}`
              : `lifecycle-command://${input.command.commandKey}`,
          artifactSummary,
          metadata: {
            sourceCommandKey: input.command.commandKey,
            sourceCommentId: input.command.commentId ?? null,
            sourceRef: input.command.sourceRef,
            openOperatorQuestionId: runtimeState.openOperatorQuestionId,
            commentBodyExcerpt,
            targetStatusCode: requestedStatusCode,
          },
        },
      ],
      metadata: {
        ...input.command.metadata,
        commentResponseWorkflowId: buildCommentResponseWorkflowId(input.command),
        commentResponseEvaluated: true,
        openOperatorQuestionId: runtimeState.openOperatorQuestionId,
        configVersion: runtimeState.pinnedConfigVersion,
        resolvedRequestedStatusCode: requestedStatusCode,
      },
    },
    completionReason: 'internal_decision_emitted',
    configVersion: runtimeState.pinnedConfigVersion,
    runKind: null,
  }
}
