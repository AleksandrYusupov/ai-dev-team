import type {
  CanonicalEventClassification,
  CanonicalEventEnvelope,
  CommentLogClassification,
} from '@ai-dev-team/shared'
import {
  isSupportedGitHubEventType,
  isSupportedLinearEventType,
} from '@ai-dev-team/shared'
import type {
  JsonObject,
  RawEventInboxRecord,
  UpsertIssueContractSnapshotInput,
  UpsertCommentLogEntryInput,
} from '@ai-dev-team/db'
import type { DbClient } from '@ai-dev-team/db'

import { parseIssueContractSnapshot } from './issue-contract.js'

interface NormalizationResult {
  canonicalEnvelope: CanonicalEventEnvelope | null
  processingStatus: 'normalized' | 'ignored'
  lastError: string | null
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryFullName: string | null
  commentLogEntry?: UpsertCommentLogEntryInput
  issueContractSnapshot?: UpsertIssueContractSnapshotInput
}

interface ClassifiedComment {
  commentClassification: CommentLogClassification
  classification: CanonicalEventClassification
  triggerCandidate: string | null
  answerValidationStatus: 'not_evaluated' | null
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

function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function getNestedObject(
  value: JsonObject,
  key: string,
): JsonObject | null {
  return asJsonObject(value[key])
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

export function containsAskDirective(markdown: string): boolean {
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, ' ')
  const withoutQuotedLines = withoutCodeBlocks
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
  const withoutInlineCode = withoutQuotedLines.replace(/`[^`]*`/g, ' ')

  return /(^|\s)@ask(\s|$)/i.test(withoutInlineCode)
}

function replayWindowValid(
  row: RawEventInboxRecord,
  replayWindowMs: number,
): boolean {
  if (!row.providerTimestamp) {
    return false
  }

  return (
    Math.abs(row.receivedAt.getTime() - row.providerTimestamp.getTime()) <=
    replayWindowMs
  )
}

export function resolveLinearReplayWindowValid(
  row: RawEventInboxRecord,
  replayWindowMs: number,
): boolean {
  if (row.replayWindowValid !== null) {
    return row.replayWindowValid
  }

  return replayWindowValid(row, replayWindowMs)
}

function buildEnvelope(input: {
  row: RawEventInboxRecord
  subjectType: string
  subjectId: string | null
  classification: CanonicalEventClassification
  triggerCandidate: string | null
  issueId: string | null
  commentId: string | null
  projectId: string | null
  repositoryId: string | null
  repositoryFullName: string | null
  installationId: string | null
  routingKey: string
  metadata: JsonObject
}): CanonicalEventEnvelope {
  return {
    envelopeVersion: 1,
    provider: input.row.provider,
    providerEventType: input.row.providerEventType,
    providerAction: input.row.providerAction,
    deliveryId: input.row.deliveryId,
    providerTimestamp: input.row.providerTimestamp?.toISOString() ?? null,
    receivedAt: input.row.receivedAt.toISOString(),
    signatureVerified: input.row.signatureStatus === 'verified',
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    issueId: input.issueId,
    commentId: input.commentId,
    projectId: input.projectId,
    repositoryId: input.repositoryId,
    repositoryFullName: input.repositoryFullName,
    installationId: input.installationId,
    routingKey: input.routingKey,
    classification: input.classification,
    triggerCandidate: input.triggerCandidate,
    payloadRef: `raw-event-inbox://${input.row.id}`,
    metadata: input.metadata,
  }
}

async function getOpenOperatorQuestionId(
  db: DbClient,
  issueId: string,
): Promise<string | null> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select('open_operator_question_id')
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  return runtimeState?.open_operator_question_id ?? null
}

export function classifyLinearComment(input: {
  action: string | null
  containsAsk: boolean
  openOperatorQuestionId: string | null
}): ClassifiedComment {
  const deleted = input.action === 'remove'
  const answerCandidate =
    !deleted && !input.containsAsk && input.openOperatorQuestionId !== null

  if (deleted) {
    return {
      commentClassification: 'deleted',
      classification: 'sync_only',
      triggerCandidate: null,
      answerValidationStatus: null,
    }
  }

  if (input.containsAsk) {
    return {
      commentClassification: 'prompt',
      classification: 'transition_candidate',
      triggerCandidate: 'human_comment_ask',
      answerValidationStatus: null,
    }
  }

  if (answerCandidate) {
    return {
      commentClassification: 'answer_candidate',
      classification: 'sync_only',
      triggerCandidate: null,
      answerValidationStatus: 'not_evaluated',
    }
  }

  return {
    commentClassification: 'informational',
    classification: 'sync_only',
    triggerCandidate: null,
    answerValidationStatus: null,
  }
}

async function normalizeLinearEvent(
  db: DbClient,
  row: RawEventInboxRecord,
  replayWindowMs: number,
): Promise<NormalizationResult> {
  if (row.signatureStatus !== 'verified') {
    return {
      canonicalEnvelope: null,
      processingStatus: 'ignored',
      lastError: 'linear_signature_not_verified',
      issueId: row.issueId,
      commentId: row.commentId,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  const resolvedReplayWindowValid = resolveLinearReplayWindowValid(
    row,
    replayWindowMs,
  )

  if (!resolvedReplayWindowValid) {
    return {
      canonicalEnvelope: null,
      processingStatus: 'ignored',
      lastError: 'linear_replay_window_exceeded',
      issueId: row.issueId,
      commentId: row.commentId,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  const payload = row.parsedPayload
  const data = getNestedObject(payload, 'data')
  const subjectId = data ? getString(data.id) : null
  const action = row.providerAction
  const eventType = row.providerEventType

  if (!isSupportedLinearEventType(eventType)) {
    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'unknown',
        subjectId,
        classification: 'ignored',
        triggerCandidate: null,
        issueId: row.issueId,
        commentId: row.commentId,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.issueId ?? `linear:${row.deliveryId}`,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
          supportedEvent: false,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: row.commentId,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'Issue') {
    const classification =
      action === 'create'
        ? 'transition_candidate'
        : action === 'update'
          ? 'metadata_refresh'
          : 'sync_only'
    const issueContractSnapshot =
      row.issueId && data
        ? parseIssueContractSnapshot({
            issueId: row.issueId,
            projectId: row.projectId,
            data,
          })
        : null

    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'issue',
        subjectId,
        classification,
        triggerCandidate: action === 'create' ? 'user_create_issue' : null,
        issueId: row.issueId,
        commentId: null,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.issueId ?? `linear:${row.deliveryId}`,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: null,
      projectId: row.projectId,
      repositoryFullName: null,
      issueContractSnapshot: issueContractSnapshot ?? undefined,
    }
  }

  if (eventType === 'Comment') {
    if (!row.issueId || !row.commentId || !data) {
      throw new Error('linear_comment_missing_identifiers')
    }

    const bodyMarkdown = getString(data.body) ?? ''
    const containsAsk = containsAskDirective(bodyMarkdown)
    const openOperatorQuestionId = await getOpenOperatorQuestionId(db, row.issueId)
    const {
      commentClassification,
      classification,
      triggerCandidate,
      answerValidationStatus,
    } = classifyLinearComment({
      action,
      containsAsk,
      openOperatorQuestionId,
    })

    const createdAt = toDate(data.createdAt) ?? row.receivedAt
    const updatedAt = toDate(data.updatedAt)

    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'comment',
        subjectId: row.commentId,
        classification,
        triggerCandidate,
        issueId: row.issueId,
        commentId: row.commentId,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.issueId,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
          containsAsk,
          openOperatorQuestionId,
          answerValidationStatus,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: row.commentId,
      projectId: row.projectId,
      repositoryFullName: null,
      commentLogEntry: {
        issueId: row.issueId,
        providerCommentId: row.commentId,
        sourceInboxEventId: row.id,
        authorActorType:
          getString(getNestedObject(payload, 'actor')?.type) ?? 'unknown',
        authorActorId: getString(getNestedObject(payload, 'actor')?.id) ?? 'unknown',
        bodyMarkdown,
        containsAsk,
        classification: commentClassification,
        sourceCreatedAt: createdAt,
        sourceUpdatedAt: updatedAt,
        deletedAt: action === 'remove' ? row.receivedAt : null,
        metadata: {
          action,
          eventType,
          openOperatorQuestionId,
          answerValidationStatus,
        },
      },
    }
  }

  if (eventType === 'Project' || eventType === 'ProjectUpdate') {
    const classification =
      eventType === 'ProjectUpdate' ? 'context_refresh' : 'metadata_refresh'

    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: eventType === 'ProjectUpdate' ? 'project_update' : 'project',
        subjectId,
        classification,
        triggerCandidate: null,
        issueId: row.issueId,
        commentId: null,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.projectId ?? `linear:${row.deliveryId}`,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: null,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'Document') {
    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'document',
        subjectId,
        classification: 'context_refresh',
        triggerCandidate: null,
        issueId: row.issueId,
        commentId: null,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.projectId ?? `linear:${row.deliveryId}`,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: null,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  if (eventType === 'IssueLabel') {
    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'issue_label',
        subjectId,
        classification: 'metadata_refresh',
        triggerCandidate: null,
        issueId: row.issueId,
        commentId: null,
        projectId: row.projectId,
        repositoryId: null,
        repositoryFullName: null,
        installationId: null,
        routingKey: row.issueId ?? `linear:${row.deliveryId}`,
        metadata: {
          replayWindowValid: resolvedReplayWindowValid,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: row.issueId,
      commentId: null,
      projectId: row.projectId,
      repositoryFullName: null,
    }
  }

  return {
    canonicalEnvelope: buildEnvelope({
      row,
      subjectType: 'unknown',
      subjectId,
      classification: 'ignored',
      triggerCandidate: null,
      issueId: row.issueId,
      commentId: row.commentId,
      projectId: row.projectId,
      repositoryId: null,
      repositoryFullName: null,
      installationId: null,
      routingKey: row.issueId ?? `linear:${row.deliveryId}`,
      metadata: {
        replayWindowValid: resolvedReplayWindowValid,
      },
    }),
    processingStatus: 'normalized',
    lastError: null,
    issueId: row.issueId,
    commentId: row.commentId,
    projectId: row.projectId,
    repositoryFullName: null,
  }
}

function githubSubjectType(eventType: string): string {
  switch (eventType) {
    case 'pull_request':
      return 'pull_request'
    case 'pull_request_review':
      return 'pull_request_review'
    case 'push':
      return 'push'
    case 'workflow_run':
      return 'workflow_run'
    case 'check_run':
      return 'check_run'
    case 'deployment_status':
      return 'deployment_status'
    default:
      return 'unknown'
  }
}

function githubSubjectId(payload: JsonObject, eventType: string): string | null {
  switch (eventType) {
    case 'pull_request':
      return getNumber(getNestedObject(payload, 'pull_request')?.id)?.toString() ?? null
    case 'pull_request_review':
      return getNumber(getNestedObject(payload, 'review')?.id)?.toString() ?? null
    case 'push':
      return getString(payload.after)
    case 'workflow_run':
      return getNumber(getNestedObject(payload, 'workflow_run')?.id)?.toString() ?? null
    case 'check_run':
      return getNumber(getNestedObject(payload, 'check_run')?.id)?.toString() ?? null
    case 'deployment_status':
      return getNumber(getNestedObject(payload, 'deployment_status')?.id)?.toString() ?? null
    default:
      return null
  }
}

async function normalizeGitHubEvent(
  row: RawEventInboxRecord,
): Promise<NormalizationResult> {
  if (row.signatureStatus !== 'verified') {
    return {
      canonicalEnvelope: null,
      processingStatus: 'ignored',
      lastError: 'github_signature_not_verified',
      issueId: null,
      commentId: null,
      projectId: null,
      repositoryFullName: row.repositoryFullName,
    }
  }

  const payload = row.parsedPayload
  const repository = getNestedObject(payload, 'repository')
  const installation = getNestedObject(payload, 'installation')
  const repositoryFullName =
    row.repositoryFullName ?? getString(repository?.full_name)

  if (!isSupportedGitHubEventType(row.providerEventType)) {
    return {
      canonicalEnvelope: buildEnvelope({
        row,
        subjectType: 'unknown',
        subjectId: null,
        classification: 'ignored',
        triggerCandidate: null,
        issueId: null,
        commentId: null,
        projectId: null,
        repositoryId: getNumber(repository?.id)?.toString() ?? null,
        repositoryFullName,
        installationId: getNumber(installation?.id)?.toString() ?? null,
        routingKey: repositoryFullName ?? `github:${row.deliveryId}`,
        metadata: {
          action: row.providerAction,
          privateRepository: getBoolean(repository?.private),
          supportedEvent: false,
        },
      }),
      processingStatus: 'normalized',
      lastError: null,
      issueId: null,
      commentId: null,
      projectId: null,
      repositoryFullName,
    }
  }

  return {
    canonicalEnvelope: buildEnvelope({
      row,
      subjectType: githubSubjectType(row.providerEventType),
      subjectId: githubSubjectId(payload, row.providerEventType),
      classification: 'sync_only',
      triggerCandidate: null,
      issueId: null,
      commentId: null,
      projectId: null,
      repositoryId: getNumber(repository?.id)?.toString() ?? null,
      repositoryFullName,
      installationId: getNumber(installation?.id)?.toString() ?? null,
      routingKey: repositoryFullName ?? `github:${row.deliveryId}`,
      metadata: {
        action: row.providerAction,
        privateRepository: getBoolean(repository?.private),
      },
    }),
    processingStatus: 'normalized',
    lastError: null,
    issueId: null,
    commentId: null,
    projectId: null,
    repositoryFullName,
  }
}

export async function normalizeRawEventInboxRow(
  db: DbClient,
  row: RawEventInboxRecord,
  replayWindowMs: number,
): Promise<NormalizationResult> {
  if (row.provider === 'linear') {
    return normalizeLinearEvent(db, row, replayWindowMs)
  }

  return normalizeGitHubEvent(row)
}
