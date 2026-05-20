import process from 'node:process'

import { loadDatabaseConfig } from '@ai-dev-team/config'

import { createDb } from './index.js'
import { publishAgentRuntimeRelease } from './agent-config/publish.js'

interface PublishCliOptions {
  releaseId?: string
  publishedBy: string
  activateForNewRuns: boolean
}

function parseCliArgs(argv: string[]): PublishCliOptions {
  let releaseId: string | undefined
  let publishedBy = process.env.AGENT_RUNTIME_RELEASE_PUBLISHED_BY ?? 'local-cli'
  let activateForNewRuns = false

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--release-id') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('--release-id must be followed by a release id')
      }

      releaseId = nextValue
      index += 1
      continue
    }

    if (value === '--published-by') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new Error('--published-by must be followed by a publisher value')
      }

      publishedBy = nextValue
      index += 1
      continue
    }

    if (value === '--activate') {
      activateForNewRuns = true
    }
  }

  return {
    releaseId,
    publishedBy,
    activateForNewRuns,
  }
}

const cli = parseCliArgs(process.argv.slice(2))
const db = createDb(loadDatabaseConfig(process.env))

try {
  const result = await publishAgentRuntimeRelease(db, cli)

  console.log(JSON.stringify(result, null, 2))
} finally {
  await db.destroy()
}
