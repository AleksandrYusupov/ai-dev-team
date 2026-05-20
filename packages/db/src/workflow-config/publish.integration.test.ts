import assert from 'node:assert/strict'
import test from 'node:test'

import { getActiveWorkflowConfigSummary, prepareTestDatabase } from '../index.js'
import { loadWorkflowManifestBundle } from './manifest-loader.js'
import { publishWorkflowConfig } from './publish.js'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function createSerializationFailureError(): Error & { code: string } {
  return Object.assign(new Error('serialization failure'), {
    code: '40001',
  })
}

test('publishWorkflowConfig is skipped without DATABASE_URL', { skip: hasDatabase }, () => {
  assert.ok(true)
})

test(
  'publishWorkflowConfig inserts once, returns idempotent no-op on identical re-publish, and rejects conflicting content',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      const firstPublish = await publishWorkflowConfig(db, bundle, {
        publishedBy: 'test-suite',
      })

      assert.equal(firstPublish.inserted, true)

      const activeConfig = await getActiveWorkflowConfigSummary(db)
      assert.equal(activeConfig?.configVersion, 1)

      const secondPublish = await publishWorkflowConfig(db, bundle, {
        publishedBy: 'test-suite',
      })

      assert.equal(secondPublish.inserted, false)

      const conflictingBundle = {
        ...bundle,
        statuses: bundle.statuses.map((status, index) =>
          index === 0 ? { ...status, description: `${status.description} changed` } : status,
        ),
      }

      await assert.rejects(
        () =>
          publishWorkflowConfig(db, conflictingBundle, {
            publishedBy: 'test-suite',
          }),
        /already exists with different content/,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'publishWorkflowConfig rejects policy-only conflicts for the same config version',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'test-suite',
      })

      const policyChangedBundle = {
        ...bundle,
        roleExecutionPolicies: bundle.roleExecutionPolicies.map((policy, index) =>
          index === 0
            ? {
                ...policy,
                maxProviderFailovers: policy.maxProviderFailovers + 1,
              }
            : policy,
        ),
      }

      await assert.rejects(
        () =>
          publishWorkflowConfig(db, policyChangedBundle, {
            publishedBy: 'test-suite',
          }),
        /already exists with different content/,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'publishWorkflowConfig persists runtime role contracts and rejects contract-only conflicts for the same config version',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      await publishWorkflowConfig(db, bundle, {
        publishedBy: 'test-suite',
      })

      const persistedContracts = await db
        .selectFrom('workflow_runtime_role_contracts')
        .selectAll()
        .where('config_version', '=', bundle.configSet.configVersion)
        .execute()

      assert.equal(persistedContracts.length, bundle.runtimeRoleContracts.length)
      assert.ok(
        persistedContracts.some(
          (row) =>
            row.role_id === 'build_agent' &&
            row.activation_mode === 'compatibility_only',
        ),
      )

      const changedBundle = {
        ...bundle,
        runtimeRoleContracts: bundle.runtimeRoleContracts.map((contract, index) =>
          index === 0
            ? {
                ...contract,
                requiredOutputArtifactTypes: [
                  ...contract.requiredOutputArtifactTypes,
                  'db_roundtrip_change',
                ],
              }
            : contract,
        ),
      }

      await assert.rejects(
        () =>
          publishWorkflowConfig(db, changedBundle, {
            publishedBy: 'test-suite',
          }),
        /already exists with different content/,
      )
    } finally {
      await db.destroy()
    }
  },
)

test(
  'publishWorkflowConfig retries once on serialization failure and preserves the publish contract',
  { skip: !hasDatabase, concurrency: false },
  async () => {
    const db = await prepareTestDatabase()

    try {
      const bundle = await loadWorkflowManifestBundle()
      const originalTransaction = db.transaction.bind(db)
      let attemptCount = 0

      const retryingDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'transaction') {
            return () => {
              const builder = originalTransaction()

              return {
                execute: async <T>(
                  callback: (trx: unknown) => Promise<T>,
                ): Promise<T> => {
                  attemptCount += 1

                  if (attemptCount === 1) {
                    throw createSerializationFailureError()
                  }

                  return builder.execute(callback)
                },
              }
            }
          }

          return Reflect.get(target, property, receiver)
        },
      }) as typeof db

      const result = await publishWorkflowConfig(retryingDb, bundle, {
        publishedBy: 'test-suite',
      })

      assert.equal(result.inserted, true)
      assert.equal(attemptCount, 2)

      const activeConfig = await getActiveWorkflowConfigSummary(db)
      assert.equal(activeConfig?.configVersion, 1)
    } finally {
      await db.destroy()
    }
  },
)
