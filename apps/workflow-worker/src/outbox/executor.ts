import {
  claimOutboxBatch,
  completeOutboxCommand,
  failOutboxCommand,
  recoverStaleRunnerLeases,
  type DbClient,
} from '@ai-dev-team/db'
import type { WorkflowWorkerConfig } from '@ai-dev-team/config'

import { buildOutboxHandlers } from './handlers.js'

export async function runOutboxExecutorOnce(
  db: DbClient,
  config: WorkflowWorkerConfig,
): Promise<number> {
  const handlers = buildOutboxHandlers(db, config)
  const batch = await claimOutboxBatch(db, {
    batchSize: config.outbox.batchSize,
    processingTimeoutMs: config.outbox.processingTimeoutMs,
  })

  for (const command of batch) {
    const handler = handlers[command.commandType]

    try {
      if (!handler) {
        throw new Error(`No outbox handler registered for ${command.commandType}`)
      }

      await handler(command)
      await completeOutboxCommand(db, command.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await failOutboxCommand(db, {
        id: command.id,
        maxAttempts: config.outbox.maxAttempts,
        error: message,
      })
    }
  }

  const recovery = await recoverStaleRunnerLeases(db)
  const recoveredCount =
    recovery.requeuedLeaseIds.length +
    recovery.heartbeatLostLeaseIds.length +
    recovery.expiredLeaseIds.length +
    recovery.releasedLeaseIds.length

  return batch.length + recoveredCount
}
