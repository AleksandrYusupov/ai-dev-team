import { claimLifecycleCommandBatch, failLifecycleCommand } from '@ai-dev-team/db'
import type { DbClient } from '@ai-dev-team/db'
import type { WorkflowWorkerConfig } from '@ai-dev-team/config'
import type { Client } from '@temporalio/client'

import { IssueLifecycleWorkflow } from '../workflows/index.js'

export async function runLifecycleCommandDispatchOnce(
  db: DbClient,
  client: Client,
  config: WorkflowWorkerConfig,
): Promise<number> {
  const batch = await claimLifecycleCommandBatch(db, {
    batchSize: config.inbox.batchSize,
    processingTimeoutMs: config.outbox.processingTimeoutMs,
  })

  for (const command of batch) {
    try {
      const canonicalWorkflowId = `issue:${command.issueId}`

      await client.workflow.signalWithStart(IssueLifecycleWorkflow, {
        workflowId: canonicalWorkflowId,
        taskQueue: config.temporal.taskQueue,
        args: [],
        signal: command.signalName,
        signalArgs: [
          {
            ...command.payload,
            workflowId: canonicalWorkflowId,
          },
        ],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      await failLifecycleCommand(db, {
        commandKey: command.commandKey,
        maxAttempts: config.inbox.maxAttempts,
        error: message,
      })
    }
  }

  return batch.length
}

export async function runLifecycleCommandDispatchLoop(
  db: DbClient,
  client: Client,
  config: WorkflowWorkerConfig,
  shouldStop: () => boolean,
): Promise<void> {
  while (!shouldStop()) {
    const dispatched = await runLifecycleCommandDispatchOnce(db, client, config)

    if (dispatched === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.inbox.pollIntervalMs),
      )
    }
  }
}
