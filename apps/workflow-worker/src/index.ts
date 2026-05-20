import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import { createDb } from '@ai-dev-team/db'
import { Client, Connection } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'

import * as activities from './activities/index.js'
import { runInboxProcessorLoop } from './inbox/executor.js'
import { runLifecycleCommandDispatchLoop } from './lifecycle/executor.js'

function resolveWorkflowsPath(metaUrl: string): string {
  const extension = path.extname(fileURLToPath(metaUrl))

  return fileURLToPath(new URL(`./workflows/index${extension}`, metaUrl))
}

async function main(): Promise<void> {
  const config = loadWorkflowWorkerConfig(process.env)
  const db = createDb(config.database)
  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  })
  const clientConnection = await Connection.connect({
    address: config.temporal.address,
  })
  const temporalClient = new Client({
    connection: clientConnection,
    namespace: config.temporal.namespace,
  })

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: resolveWorkflowsPath(import.meta.url),
    activities,
  })

  let stopping = false

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) {
        return
      }

      stopping = true
      worker.shutdown()
    })
  }

  try {
    await Promise.all([
      worker.run(),
      runInboxProcessorLoop(db, config, () => stopping),
      runLifecycleCommandDispatchLoop(db, temporalClient, config, () => stopping),
    ])
  } finally {
    await db.destroy()
    await connection.close()
    await clientConnection.close()
  }
}

main().catch((error) => {
  console.error('workflow-worker failed', error)
  process.exit(1)
})
