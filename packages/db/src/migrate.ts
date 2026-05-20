import { loadDatabaseConfig } from '@ai-dev-team/config'

import { migrateToLatest } from './index.js'

const results = await migrateToLatest(loadDatabaseConfig(process.env))

for (const result of results) {
  console.log(`${result.migrationName}: ${result.status}`)
}

