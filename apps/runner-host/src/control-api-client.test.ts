import assert from 'node:assert/strict'
import test from 'node:test'

import { RunnerControlApiClient } from './control-api-client.js'

test('control-api client sends bearer auth to runner-host routes', async () => {
  const seen: Array<{ url: string; method: string; auth?: string | null }> = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers = new Headers(init?.headers ?? {})
    seen.push({
      url,
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
    })

    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        task: null,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    )
  }) as typeof fetch

  try {
    const client = new RunnerControlApiClient({
      baseUrl: 'http://127.0.0.1:4000',
      authToken: 'runner-token',
      runnerNodeId: 'runner-node-1',
    })

    await client.claimNext(new Date().toISOString())

    assert.equal(seen[0]?.method, 'POST')
    assert.equal(seen[0]?.auth, 'Bearer runner-token')
    assert.equal(seen[0]?.url.endsWith('/runner-host/leases:claim-next'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('control-api client addresses managed skill sync endpoints', async () => {
  const seen: string[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    void init
    const url = typeof input === 'string' ? input : input.toString()
    seen.push(url)

    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'v1',
        releaseFingerprint: 'fp-1',
        publishedAt: '2026-03-28T12:00:00.000Z',
        skills: [],
        skillCount: 0,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    )
  }) as typeof fetch

  try {
    const client = new RunnerControlApiClient({
      baseUrl: 'http://127.0.0.1:4000',
      authToken: 'runner-token',
      runnerNodeId: 'runner-node-1',
    })

    await client.fetchActiveSkillReleaseSummary()
    await client.fetchSkillReleasePayload('v1')

    assert.equal(
      seen[0]?.endsWith('/runner-host/skill-sync/active-release'),
      true,
    )
    assert.equal(
      seen[1]?.endsWith('/runner-host/skill-sync/releases/v1'),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('control-api client addresses execution bundle endpoint', async () => {
  const seen: string[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    void init
    const url = typeof input === 'string' ? input : input.toString()
    seen.push(url)

    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        leaseAttemptId: 'attempt-1',
        agentLibraryReleaseId: 'v1',
        agentLibraryFingerprint: 'library-fingerprint-v1',
        taskInstructionsRef:
          'agent-library://releases/v1/prompt-bundles/build_agent',
        promptVersion: 'v1',
        roleCharterRef:
          'agent-library://releases/v1/role-charters/build_agent_backend',
        promptBundleFingerprint: 'bundle-fingerprint-1',
        resolvedPromptFamilyRefs: ['global-baseline', 'build'],
        skillPackRefs: ['build_backend_core'],
        resolvedSkillRefs: ['S46'],
        skippedOptionalSkillRefs: ['S47'],
        roleCharter: {
          roleCharterRef:
            'agent-library://releases/v1/role-charters/build_agent_backend',
          roleId: 'build_agent_backend',
          charterVersion: 'v1',
          canonicalRunKind: 'build',
          frontmatterSummary: {},
          sourceRefs: [],
          relativePath: 'config/agents/role-charters/build_agent_backend/v1.md',
          roleFingerprint: 'role-fingerprint-1',
          body: '# Role charter\n',
        },
        promptFamilies: [],
        skillPacks: [],
        runtimeRoleContract: {
          roleId: 'build_agent_backend',
          canonicalRunKind: 'build',
          allowedStatusOwnership: [],
          requiredInputArtifactTypes: [],
          requiredOutputArtifactTypes: [],
          humanGatePolicy: {
            mode: 'conditional',
            requiredHumanOwnedZones: [],
            notes: null,
          },
          escalationReasonCodes: [],
          activationMode: 'active',
        },
        roleExecutionPolicy: {
          ownerRole: 'build_agent_backend',
          primaryProvider: 'codex',
          secondaryProvider: 'claude',
          fallbackTriggers: [],
          maxProviderFailovers: 1,
          mcpProfileRef: 'default',
          requiredCapabilities: ['workspace_access'],
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    )
  }) as typeof fetch

  try {
    const client = new RunnerControlApiClient({
      baseUrl: 'http://127.0.0.1:4000',
      authToken: 'runner-token',
      runnerNodeId: 'runner-node-1',
    })

    await client.fetchExecutionBundle('attempt-1')

    assert.equal(
      seen[0]?.endsWith('/runner-host/attempts/attempt-1/execution-bundle'),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
