import {
  createRunnerLeaseFromCommand,
  releaseRunnerLeaseFromCommand,
  unwrapOutboxCommandEnvelope,
  type DbClient,
  type JsonObject,
  type OutboxCommandRecord,
} from '@ai-dev-team/db'
import type { WorkflowWorkerConfig } from '@ai-dev-team/config'

import { buildSyncLinearStateHandler } from './linear-state-sync.js'

export type OutboxHandler = (command: OutboxCommandRecord) => Promise<void>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parseJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {}
}

function parseReviewDisposition(value: unknown): string | null {
  return value === 'human_gate_required' ||
    value === 'rework_recommended' ||
    value === 'review_inconclusive'
    ? value
    : null
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function postLinearComment(input: {
  apiBaseUrl: string
  apiToken: string
  issueId: string
  body: string
}): Promise<void> {
  const response = await fetch(input.apiBaseUrl, {
    method: 'POST',
    headers: {
      Authorization: input.apiToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation Phase7CommentCreate($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
          }
        }
      `,
      variables: {
        issueId: input.issueId,
        body: input.body,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Linear comment post failed: ${response.status} ${response.statusText} ${await response.text()}`,
    )
  }

  const body = await response.json() as {
    data?: { commentCreate?: { success?: boolean } }
    errors?: Array<{ message?: string }>
  }

  if (!body.data?.commentCreate?.success) {
    throw new Error(
      `Linear comment post did not succeed: ${stringifyJson(body.errors ?? body.data ?? {})}`,
    )
  }
}

function buildPhase7LinearComment(input: {
  issueId: string
  decisionSummary: string | null
  reviewDisposition: string | null
  recommendedNextAction: string | null
  reviewedBuildArtifactId: string | null
  reviewFindings: unknown
}): string {
  const findingCount = Array.isArray(input.reviewFindings)
    ? input.reviewFindings.length
    : 0

  return [
    'Phase 7 review decision summary',
    '',
    `Issue: ${input.issueId}`,
    `Disposition: ${input.reviewDisposition ?? 'human_gate_required'}`,
    `Reviewed build artifact: ${input.reviewedBuildArtifactId ?? 'n/a'}`,
    `Findings: ${findingCount.toString()}`,
    '',
    'Summary:',
    input.decisionSummary ??
      'Review completed and is waiting for a human decision.',
    '',
    'Recommended next action:',
    input.recommendedNextAction ??
      'Review the summary and decide whether the issue should return to coding.',
  ].join('\n')
}

function buildLinearCommentFailureContext(command: OutboxCommandRecord): {
  issueId: string
  runId: string | null
  outboxId: string
  transitionAuditId: string | null
} {
  return {
    issueId: command.issueId,
    runId: command.runId,
    outboxId: command.id,
    transitionAuditId: command.transitionAuditId,
  }
}

function buildCreateRunnerLeaseHandler(db: DbClient): OutboxHandler {
  return async (command) => {
    const envelope = unwrapOutboxCommandEnvelope(command.commandPayload)
    const body = isRecord(envelope.body) ? envelope.body : {}

    await createRunnerLeaseFromCommand(db, {
      commandKey: envelope.commandKey,
      issueId: envelope.issueId,
      runId: envelope.runId,
      workflowId: envelope.workflowId,
      configVersion: envelope.configVersion,
      requestedOwnerRole: parseStringOrNull(body.requestedOwnerRole) ?? 'orchestrator',
      requestedRunKind: parseStringOrNull(body.requestedRunKind),
      runnerRequirementProfile: parseJsonObject(body.runnerRequirementProfile),
      contextPackFingerprint: parseStringOrNull(body.contextPackFingerprint),
      checkpointId: parseStringOrNull(body.checkpointId),
      transitionAuditId: envelope.transitionAuditId,
    })
  }
}

function buildReleaseRunnerLeaseHandler(db: DbClient): OutboxHandler {
  return async (command) => {
    const envelope = unwrapOutboxCommandEnvelope(command.commandPayload)
    const body = isRecord(envelope.body) ? envelope.body : {}

    await releaseRunnerLeaseFromCommand(db, {
      commandKey: envelope.commandKey,
      leaseId: parseStringOrNull(body.leaseId),
      issueId: envelope.issueId,
      runId: envelope.runId,
      requestedOwnerRole: parseStringOrNull(body.requestedOwnerRole),
      reasonCode: parseStringOrNull(body.reasonCode),
      reasonText: parseStringOrNull(body.reasonText),
    })
  }
}

function buildPostLinearCommentHandler(
  db: DbClient,
  config: WorkflowWorkerConfig,
): OutboxHandler {
  return async (command) => {
    if (!config.linear.apiToken) {
      const error = new Error(
        'post_linear_comment requires LINEAR_API_TOKEN to be configured',
      )
      console.error('post_linear_comment failed before delivery', {
        ...buildLinearCommentFailureContext(command),
        reason: error.message,
      })
      throw error
    }

    if (!command.transitionAuditId) {
      const error = new Error(
        'post_linear_comment requires a transition audit id to resolve review artifacts',
      )
      console.error('post_linear_comment failed before delivery', {
        ...buildLinearCommentFailureContext(command),
        reason: error.message,
      })
      throw error
    }

    const artifacts = await db
      .selectFrom('artifact_registry')
      .select(['artifact_type', 'metadata'])
      .where('transition_audit_id', '=', command.transitionAuditId)
      .where('artifact_type', 'in', ['decision_summary', 'review_report'])
      .where('superseded_at', 'is', null)
      .execute()

    const decisionSummaryArtifact = artifacts.find(
      (artifact) => artifact.artifact_type === 'decision_summary',
    )
    const reviewReportArtifact = artifacts.find(
      (artifact) => artifact.artifact_type === 'review_report',
    )
    const decisionSummaryMetadata = parseJsonObject(
      decisionSummaryArtifact?.metadata ?? {},
    )
    const reviewReportMetadata = parseJsonObject(reviewReportArtifact?.metadata ?? {})

    try {
      await postLinearComment({
        apiBaseUrl: config.linear.apiBaseUrl,
        apiToken: config.linear.apiToken,
        issueId: command.issueId,
        body: buildPhase7LinearComment({
          issueId: command.issueId,
          decisionSummary:
            parseStringOrNull(decisionSummaryMetadata.summary) ??
            parseStringOrNull(decisionSummaryMetadata.decisionSummary),
          reviewDisposition: parseReviewDisposition(
            reviewReportMetadata.reviewDisposition,
          ),
          recommendedNextAction: parseStringOrNull(
            decisionSummaryMetadata.recommendedNextAction ??
              reviewReportMetadata.recommendedNextAction,
          ),
          reviewedBuildArtifactId: parseStringOrNull(
            reviewReportMetadata.reviewedBuildArtifactId,
          ),
          reviewFindings: reviewReportMetadata.reviewFindings ?? [],
        }),
      })
    } catch (error) {
      console.error('post_linear_comment delivery failed', {
        ...buildLinearCommentFailureContext(command),
        reason: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

export function buildOutboxHandlers(
  db: DbClient,
  config: WorkflowWorkerConfig,
): Record<string, OutboxHandler> {
  return {
    post_linear_comment: buildPostLinearCommentHandler(db, config),
    sync_linear_state: buildSyncLinearStateHandler(db, config),
    create_runner_lease: buildCreateRunnerLeaseHandler(db),
    release_runner_lease: buildReleaseRunnerLeaseHandler(db),
  }
}
