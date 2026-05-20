import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import { createDb } from '@ai-dev-team/db'

import { runInboxProcessorLoop } from './inbox/executor.js'

const config = loadWorkflowWorkerConfig(process.env)
const db = createDb(config.database)

let stopping = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true
  })
}

try {
  await runInboxProcessorLoop(db, config, () => stopping)
} finally {
  await db.destroy()
}
