import {
  claimRawEventInboxBatch,
  failRawEventInboxRow,
  markRawEventInboxProcessed,
  upsertLifecycleCommand,
  upsertIssueContractSnapshot,
  upsertCommentLogEntry,
  type DbClient,
  type DbSession,
} from '@ai-dev-team/db'
import type { WorkflowWorkerConfig } from '@ai-dev-team/config'
import type { LifecycleCommandEnvelopeV1 } from '@ai-dev-team/shared'

import { normalizeRawEventInboxRow } from './normalizers.js'
import {
  enqueueLinearStateSyncCommand,
  ensureIssueLinearSyncProjectionFromContract,
  reconcileGitHubLinearSyncProjection,
} from '../linear-sync.js'

async function issueNeedsHumanInput(
  db: DbSession,
  issueId: string,
): Promise<boolean> {
  const runtimeState = await db
    .selectFrom('issue_runtime_state')
    .select('current_status_code')
    .where('issue_id', '=', issueId)
    .executeTakeFirst()

  return runtimeState?.current_status_code === 'needs_input'
}

async function buildLifecycleCommandEnvelope(input: {
  db: DbSession
  row: Awaited<ReturnType<typeof claimRawEventInboxBatch>>[number]
  normalized: Awaited<ReturnType<typeof normalizeRawEventInboxRow>>
}): Promise<LifecycleCommandEnvelopeV1 | null> {
  const envelope = input.normalized.canonicalEnvelope

  if (!envelope || !input.row.issueId) {
    return null
  }

  const baseEnvelope: LifecycleCommandEnvelopeV1 = {
    schemaVersion: 1,
    commandKey: '',
    issueId: input.row.issueId,
    workflowId: `issue:${input.row.issueId}`,
    signalName: 'ingestCanonicalEvent',
    source: 'raw_event_inbox',
    sourceRef: input.row.id,
    occurredAt: envelope.receivedAt,
    actorType: 'system',
    actorId: `ingress/${input.row.provider}`,
    canonicalEventId: input.row.id,
    triggerCode: envelope.triggerCandidate,
    commentId: input.row.commentId,
    metadata: {
      payloadRef: envelope.payloadRef,
      providerEventType: input.row.providerEventType,
      providerAction: input.row.providerAction,
      routingKey: envelope.routingKey,
      canonicalClassification: envelope.classification,
    },
  }

  if (
    envelope.subjectType === 'issue' &&
    envelope.triggerCandidate === 'user_create_issue'
  ) {
    return {
      ...baseEnvelope,
      commandKey: `raw-event:${input.row.id}:user_create_issue`,
    }
  }

  if (!input.normalized.commentLogEntry) {
    return null
  }

  if (
    input.normalized.commentLogEntry.classification === 'prompt' &&
    envelope.triggerCandidate === 'human_comment_ask'
  ) {
    return {
      ...baseEnvelope,
      commandKey: `raw-event:${input.row.id}:human_comment_ask`,
      actorType: 'human',
      actorId: input.normalized.commentLogEntry.authorActorId,
      metadata: {
        ...baseEnvelope.metadata,
        commentClassification: input.normalized.commentLogEntry.classification,
      },
    }
  }

  if (
    input.normalized.commentLogEntry.classification === 'answer_candidate' &&
    input.row.commentId &&
    (await issueNeedsHumanInput(input.db, input.row.issueId))
  ) {
    return {
      ...baseEnvelope,
      commandKey: `raw-event:${input.row.id}:human_input_received`,
      actorType: 'human',
      actorId: input.normalized.commentLogEntry.authorActorId,
      triggerCode: 'human_input_received',
      metadata: {
        ...baseEnvelope.metadata,
        commentClassification: input.normalized.commentLogEntry.classification,
      },
    }
  }

  return null
}

export async function runInboxProcessorOnce(
  db: DbClient,
  config: WorkflowWorkerConfig,
): Promise<number> {
  const trx = await db.startTransaction().execute()

  try {
    const batch = await claimRawEventInboxBatch(trx, config.inbox.batchSize)

    for (const row of batch) {
      const savepointName = 'raw_inbox_row' as const
      const rowTrx = await trx.savepoint(savepointName).execute()

      try {
        const normalized = await normalizeRawEventInboxRow(
          rowTrx,
          row,
          config.inbox.replayWindowMs,
        )

        if (normalized.commentLogEntry) {
          await upsertCommentLogEntry(rowTrx, normalized.commentLogEntry)
        }

        if (normalized.issueContractSnapshot) {
          await upsertIssueContractSnapshot(
            rowTrx,
            normalized.issueContractSnapshot,
          )

          await ensureIssueLinearSyncProjectionFromContract(rowTrx, {
            issueId: normalized.issueContractSnapshot.issueId,
            primaryRepo: normalized.issueContractSnapshot.primaryRepo,
            affectedRepos: normalized.issueContractSnapshot.affectedRepos,
          })
        }

        const lifecycleCommand = await buildLifecycleCommandEnvelope({
          db: rowTrx,
          row,
          normalized,
        })

        if (lifecycleCommand) {
          await upsertLifecycleCommand(rowTrx, lifecycleCommand)
        }

        let correlatedGitHubIssueId: string | null = null

        if (row.provider === 'github') {
          const githubSync = await reconcileGitHubLinearSyncProjection(rowTrx, {
            providerEventType: row.providerEventType,
            providerAction: row.providerAction,
            repositoryFullName:
              normalized.repositoryFullName ?? row.repositoryFullName,
            payload: row.parsedPayload,
          })

          correlatedGitHubIssueId = githubSync.issueId

          if (githubSync.changed && githubSync.issueId) {
            await enqueueLinearStateSyncCommand(rowTrx, {
              issueId: githubSync.issueId,
              transitionAuditId: null,
              milestoneEvent: githubSync.milestoneEvent,
            })
          }
        }

        await markRawEventInboxProcessed(rowTrx, {
          id: row.id,
          processingStatus: lifecycleCommand
            ? 'dispatched'
            : normalized.processingStatus,
          canonicalEnvelope: normalized.canonicalEnvelope,
          issueId: normalized.issueId ?? correlatedGitHubIssueId,
          commentId: normalized.commentId,
          projectId: normalized.projectId,
          repositoryFullName: normalized.repositoryFullName,
          lastError: normalized.lastError,
        })

        await rowTrx.releaseSavepoint(savepointName).execute()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        await rowTrx.rollbackToSavepoint(savepointName).execute()
        await rowTrx.releaseSavepoint(savepointName).execute()
        await failRawEventInboxRow(trx, {
          id: row.id,
          maxAttempts: config.inbox.maxAttempts,
          error: message,
        })
      }
    }

    await trx.commit().execute()

    return batch.length
  } catch (error) {
    await trx.rollback().execute()
    throw error
  }
}

export async function runInboxProcessorLoop(
  db: DbClient,
  config: WorkflowWorkerConfig,
  shouldStop: () => boolean,
): Promise<void> {
  while (!shouldStop()) {
    const processed = await runInboxProcessorOnce(db, config)

    if (processed === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.inbox.pollIntervalMs),
      )
    }
  }
}
