import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import { createDb } from '@ai-dev-team/db'

import { runOutboxExecutorOnce } from './outbox/executor.js'

const config = loadWorkflowWorkerConfig(process.env)
const db = createDb(config.database)

let stopping = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true
  })
}

try {
  while (!stopping) {
    const processed = await runOutboxExecutorOnce(db, config)

    if (processed === 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.outbox.pollIntervalMs),
      )
    }
  }
} finally {
  await db.destroy()
}
