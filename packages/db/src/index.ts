import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
  type Transaction,
} from 'kysely'
import { Pool } from 'pg'

import type { DatabaseConfig } from '@ai-dev-team/config'

import type { Database } from './schema.js'

export function createPool(config: DatabaseConfig): Pool {
  return new Pool({
    connectionString: config.url,
    max: config.poolMax,
  })
}

export function createDb(config: DatabaseConfig): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: createPool(config),
    }),
  })
}

export function resolveMigrationsFolder(metaUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./migrations', metaUrl))
}

export async function migrateToLatest(config: DatabaseConfig) {
  const db = createDb(config)

  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: resolveMigrationsFolder(),
      }),
    })

    const { error, results } = await migrator.migrateToLatest()

    if (error) {
      throw error
    }

    return results ?? []
  } finally {
    await db.destroy()
  }
}

export type DbClient = Kysely<Database>
export type DbSession = Kysely<Database> | Transaction<Database>

export * from './schema.js'
export * from './runtime.js'
export * from './ingress.js'
export * from './integrations.js'
export * from './lifecycle.js'
export * from './runners.js'
export * from './testing/database.js'
export * from './agent-config/manifest-loader.js'
export * from './agent-config/publish.js'
export * from './agent-config/types.js'
export * from './workflow-config/manifest-loader.js'
export * from './workflow-config/publish.js'
export * from './workflow-config/types.js'
