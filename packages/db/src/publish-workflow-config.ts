import { loadDatabaseConfig } from '@ai-dev-team/config'

import { createDb } from './index.js'
import {
  loadWorkflowManifestBundle,
  workflowManifestFingerprint,
} from './workflow-config/manifest-loader.js'
import { publishWorkflowConfig } from './workflow-config/publish.js'

const bundle = await loadWorkflowManifestBundle()
const db = createDb(loadDatabaseConfig(process.env))

try {
  const result = await publishWorkflowConfig(db, bundle, {
    publishedBy: process.env.WORKFLOW_CONFIG_PUBLISHED_BY ?? 'local-cli',
  })

  console.log(
    JSON.stringify(
      {
        ...result,
        fingerprint: workflowManifestFingerprint(bundle),
      },
      null,
      2,
    ),
  )
} finally {
  await db.destroy()
}
