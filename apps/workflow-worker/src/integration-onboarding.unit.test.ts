import assert from 'node:assert/strict'
import test from 'node:test'

import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'

import {
  createTemporalTestEnvironment,
  createTemporalTestWorker,
  shutdownTemporalTestWorker,
  waitForCondition,
} from './testing/temporal.js'
import {
  getIntegrationOnboardingSnapshotQuery,
  ingestIntegrationOnboardingEventSignal,
  IntegrationOnboardingWorkflow,
} from './workflows/index.js'

const runTemporalUnitTests = process.env.RUN_TEMPORAL_UNIT_TESTS === 'true'

test(
  'IntegrationOnboardingWorkflow tracks pending actions until integration verification completes',
  { skip: !runTemporalUnitTests },
  async () => {
  const env = await createTemporalTestEnvironment()
  const worker = await createTemporalTestWorker(
    env,
    loadWorkflowWorkerConfig({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    }),
  )

  try {
    const handle = await env.client.workflow.start(IntegrationOnboardingWorkflow, {
      workflowId: 'integration-onboarding:ISSUE-1:stripe',
      taskQueue: 'ai-dev-team',
      args: [
        {
          issueId: 'ISSUE-1',
          providerName: 'stripe',
          initialPendingAction: 'upload sandbox credentials',
        },
      ],
    })

    const initial = await handle.query(getIntegrationOnboardingSnapshotQuery)

    assert.equal(initial.completed, false)
    assert.equal(initial.pendingAction, 'upload sandbox credentials')

    await handle.signal(ingestIntegrationOnboardingEventSignal, {
      code: 'credential_validated',
      occurredAt: '2026-03-26T12:00:00.000Z',
      pendingAction: 'complete OAuth consent',
    })

    await waitForCondition(async () => {
      const snapshot = await handle.query(getIntegrationOnboardingSnapshotQuery)
      return snapshot.lastEventCode === 'credential_validated'
    })

    const mid = await handle.query(getIntegrationOnboardingSnapshotQuery)

    assert.equal(mid.completed, false)
    assert.equal(mid.pendingAction, 'complete OAuth consent')

    await handle.signal(ingestIntegrationOnboardingEventSignal, {
      code: 'integration_verified',
      occurredAt: '2026-03-26T12:05:00.000Z',
      pendingAction: null,
    })

    await handle.result()

    const done = await handle.query(getIntegrationOnboardingSnapshotQuery)

    assert.equal(done.completed, true)
    assert.equal(done.pendingAction, null)
    assert.equal(done.lastEventCode, 'integration_verified')
    } finally {
      await shutdownTemporalTestWorker(worker)
      await env.teardown()
    }
  },
)
