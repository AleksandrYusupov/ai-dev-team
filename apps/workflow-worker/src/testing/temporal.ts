import { loadWorkflowWorkerConfig } from '@ai-dev-team/config'
import type { LifecycleCommandEnvelopeV1, SharedJsonObject } from '@ai-dev-team/shared'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { fileURLToPath } from 'node:url'

import * as activities from '../activities/index.js'

export interface TemporalTestWorkerHandle {
  worker: Worker
  runPromise: Promise<unknown>
}

const TEARDOWN_TIMEOUT_MS = 10_000
const shutdownPromises = new WeakMap<TemporalTestWorkerHandle, Promise<void>>()
const completedShutdowns = new WeakSet<TemporalTestWorkerHandle>()

function resolveWorkflowsPath(metaUrl: string): string {
  return fileURLToPath(new URL('../workflows/index.js', metaUrl))
}

export async function createTemporalTestEnvironment(): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.createTimeSkipping()
}

export async function createTemporalTestWorker(
  env: { nativeConnection: unknown; namespace?: string },
  config = loadWorkflowWorkerConfig(process.env),
  metaUrl: string = import.meta.url,
): Promise<TemporalTestWorkerHandle> {
  const worker = await Worker.create({
    connection: env.nativeConnection as never,
    namespace: env.namespace ?? config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: resolveWorkflowsPath(metaUrl),
    activities,
  })

  return {
    worker,
    runPromise: worker.run(),
  }
}

export async function shutdownTemporalTestWorker(
  handle: TemporalTestWorkerHandle,
): Promise<void> {
  if (completedShutdowns.has(handle)) {
    return
  }

  const existingShutdown = shutdownPromises.get(handle)

  if (existingShutdown) {
    await existingShutdown
    return
  }

  const shutdownPromise = (async () => {
    await settlePromiseWithinTimeout(
      Promise.resolve().then(() => handle.worker.shutdown()),
      'Temporal worker shutdown',
    )
    await settlePromiseWithinTimeout(
      handle.runPromise,
      'Temporal worker run loop settlement',
    )
    completedShutdowns.add(handle)
  })().finally(() => {
    shutdownPromises.delete(handle)
  })

  shutdownPromises.set(handle, shutdownPromise)
  await shutdownPromise
}

async function settlePromiseWithinTimeout(
  promise: Promise<unknown>,
  label: string,
  timeoutMs: number = TEARDOWN_TIMEOUT_MS,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  try {
    const outcome = await Promise.race([
      promise.then(
        () => 'settled' as const,
        (error) => ({ error } as const),
      ),
      new Promise<'timeout'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs)
        timeoutHandle.unref?.()
      }),
    ])

    if (outcome === 'timeout') {
      console.warn(`${label} timed out during teardown`, {
        timeoutMs,
      })
      return
    }

    if (typeof outcome === 'object' && outcome !== null && 'error' in outcome) {
      console.warn(`${label} failed during teardown`, {
        error: (outcome as { error: unknown }).error,
      })
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  input: {
    timeoutMs?: number
    intervalMs?: number
  } = {},
): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const intervalMs = input.intervalMs ?? 50
  const startedAt = Date.now()

  while (true) {
    if (await predicate()) {
      return
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs.toString()}ms waiting for condition`)
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export function buildLifecycleCommand(
  input: Partial<LifecycleCommandEnvelopeV1> &
    Pick<LifecycleCommandEnvelopeV1, 'commandKey' | 'issueId'>,
): LifecycleCommandEnvelopeV1 {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const metadata: SharedJsonObject = input.metadata ?? {}

  return {
    schemaVersion: 1,
    commandKey: input.commandKey,
    issueId: input.issueId,
    workflowId: input.workflowId ?? `issue:${input.issueId}`,
    signalName: input.signalName ?? 'ingestCanonicalEvent',
    source: input.source ?? 'workflow_test',
    sourceRef: input.sourceRef ?? input.commandKey,
    occurredAt,
    actorType: input.actorType ?? 'system',
    actorId: input.actorId ?? 'workflow-test',
    canonicalEventId: input.canonicalEventId ?? null,
    triggerCode: input.triggerCode ?? null,
    requestedStatusCode: input.requestedStatusCode ?? null,
    commentId: input.commentId ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    checkpointId: input.checkpointId ?? null,
    leaseId: input.leaseId ?? null,
    blockedByIssueIds: input.blockedByIssueIds ?? [],
    guardOutcomes: input.guardOutcomes ?? {},
    artifacts: input.artifacts,
    metadata,
  }
}
