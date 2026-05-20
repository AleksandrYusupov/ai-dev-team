import { loadControlApiConfig } from '@ai-dev-team/config'
import {
  createDb,
  getActiveWorkflowConfigSummary,
  getBlockedIssueProjectionView,
  getIssueLinearSyncProjectionView,
  getIssueRuntimeStateView,
  getStatusProjectionView,
  persistRawEventDelivery,
} from '@ai-dev-team/db'

import { createApp } from './app.js'
import { createIntegrationReadRepository, createIntegrationWriteRepository } from './integrations.js'
import { createKnowledgeReadRepository } from './knowledge.js'
import {
  createLifecycleReadRepository,
} from './lifecycle.js'
import { createRunnerReadRepository, createRunnerWriteRepository } from './runners.js'

const config = loadControlApiConfig(process.env)
const db = createDb(config.database)
const app = createApp({
  config,
  workflowReadRepository: {
    getActiveWorkflowConfig: () => getActiveWorkflowConfigSummary(db),
    getIssueRuntimeState: (issueId) => getIssueRuntimeStateView(db, issueId),
    getStatusProjection: (issueId) => getStatusProjectionView(db, issueId),
    getIssueLinearSyncProjection: (issueId) =>
      getIssueLinearSyncProjectionView(db, issueId),
    getBlockedIssueProjection: (issueId) =>
      getBlockedIssueProjectionView(db, issueId),
  },
  knowledgeReadRepository: createKnowledgeReadRepository({
    db,
    config,
  }),
  lifecycleReadRepository: createLifecycleReadRepository({
    db,
  }),
  runnerReadRepository: createRunnerReadRepository({
    db,
  }),
  runnerWriteRepository: createRunnerWriteRepository({
    db,
  }),
  integrationReadRepository: createIntegrationReadRepository({
    db,
  }),
  integrationWriteRepository: createIntegrationWriteRepository({
    db,
  }),
  webhookIngressRepository: {
    persistRawEventDelivery: (input) => persistRawEventDelivery(db, input),
  },
})

let closing = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) {
    return
  }

  closing = true
  app.log.info({ signal }, 'shutting down control-api')

  try {
    await app.close()
    await db.destroy()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'failed to close control-api cleanly')
    process.exit(1)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

try {
  await app.listen({
    host: config.host,
    port: config.port,
  })
} catch (error) {
  app.log.error({ err: error }, 'failed to start control-api')
  process.exit(1)
}
