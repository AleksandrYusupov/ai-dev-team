import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type {
  RunnerManagedSkillPayloadV1,
  RunnerManagedSkillSummaryV1,
} from '@ai-dev-team/shared'

import { loadRunnerHostAppConfig } from './config.js'
import type { RunnerControlApiClient } from './control-api-client.js'
import { SkillSyncManager } from './skill-sync.js'

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

class TestSkillSyncClient {
  public summaryCalls = 0
  public payloadCalls = 0

  constructor(
    private readonly summary: RunnerManagedSkillSummaryV1,
    private readonly payloadFactory: (releaseId: string) => RunnerManagedSkillPayloadV1,
  ) {}

  async fetchActiveSkillReleaseSummary(): Promise<RunnerManagedSkillSummaryV1> {
    this.summaryCalls += 1
    return this.summary
  }

  async fetchSkillReleasePayload(
    releaseId: string,
  ): Promise<RunnerManagedSkillPayloadV1> {
    this.payloadCalls += 1
    return this.payloadFactory(releaseId)
  }
}

function buildRealRunnerEnv(root: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ai_dev_team',
    RUNNER_NODE_ID: 'runner-node',
    RUNNER_HOST_GROUP_ID: 'host-group',
    RUNNER_AUTH_TOKEN: 'runner-token',
    RUNNER_WORKSPACE_ROOT: path.join(root, 'workspace'),
    RUNNER_WORKTREE_ROOT: path.join(root, 'worktrees'),
    RUNNER_ARTIFACT_ROOT: path.join(root, 'artifacts'),
    RUNNER_MCP_CONFIG_HASH: 'config-hash',
    RUNNER_PROVIDERS: 'codex,claude',
    RUNNER_MCP_HOST_SERVERS: 'obsidian,context7',
    RUNNER_MCP_REPO_SERVERS: 'serena',
    RUNNER_MCP_EXCLUSIVE_SERVERS: '',
    RUNNER_SKILL_CACHE_ROOT: path.join(root, 'managed-skills'),
    CODEX_COMMAND: '',
    CLAUDE_CODE_COMMAND: '',
    CODEX_CLI_BIN: '',
    CLAUDE_CLI_BIN: '',
  }
}

function buildSkillSummary(
  releaseId = 'v1',
  fingerprint = 'release-fingerprint-v1',
): RunnerManagedSkillSummaryV1 {
  return {
    schemaVersion: 1,
    releaseId,
    releaseFingerprint: fingerprint,
    publishedAt: '2026-03-28T12:00:00.000Z',
    skills: [
      {
        skillId: 'S46',
        fingerprint: 'skill-fingerprint-S46',
        providerCompatibility: ['codex'],
      },
    ],
  }
}

function buildSkillPayload(
  releaseId = 'v1',
  fingerprint = 'release-fingerprint-v1',
): RunnerManagedSkillPayloadV1 {
  const metaJson = `${JSON.stringify(
    {
      id: 'S46',
      version: '1.0.0',
      name: 'Managed Skill',
      category: 'custom',
      availability: 'runtime',
      kind: 'custom',
      runtimeDependency: true,
      referenceOnlyDefault: false,
      providerCompatibility: ['codex'],
      requiredTools: [],
      requiredMcp: [],
      sensitivityClass: 'standard',
      whenToUse: ['test'],
      inputs: [],
      steps: [],
      stopConditions: [],
      escalationRules: [],
      antiPatterns: [],
      deniedActions: [],
      humanGate: {
        required: false,
        zones: [],
        notes: null,
      },
      description: 'Managed skill payload',
      why: 'Test runner-side sync',
      downloadRef: null,
      buildSpec: null,
      sourceRefs: ['tests'],
    },
    null,
    2,
  )}\n`
  const skillMarkdown = '# Managed Skill\n'

  return {
    schemaVersion: 1,
    releaseId,
    releaseFingerprint: fingerprint,
    publishedAt: '2026-03-28T12:00:00.000Z',
    skillCount: 1,
    skills: [
      {
        skillId: 'S46',
        fingerprint: 'skill-fingerprint-S46',
        relativePath: `config/agents/releases/${releaseId}/skills/S46/SKILL.md`,
        metaJson,
        metaSha256: hashSha256(metaJson),
        skillMarkdown,
        skillMarkdownSha256: hashSha256(skillMarkdown),
        providerCompatibility: ['codex'],
      },
    ],
  }
}

test('SkillSyncManager installs the active release and resolves execution bundles', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'skill-sync-manager-'))

  try {
    const config = loadRunnerHostAppConfig(buildRealRunnerEnv(sandboxRoot))
    const client = new TestSkillSyncClient(
      buildSkillSummary(),
      (releaseId) => buildSkillPayload(releaseId),
    )
    const manager = new SkillSyncManager(
      config,
      client as unknown as RunnerControlApiClient,
    )

    await manager.initialize()

    const state = manager.getManifestState()
    const bundle = await manager.resolveExecutionBundle('v1')

    assert.equal(state.skillSyncStatus, 'ready')
    assert.equal(state.activeAgentLibraryReleaseId, 'v1')
    assert.deepEqual(state.skillsAvailable, ['S46'])
    assert.equal(state.installedSkillBundles.length, 1)
    assert.ok(bundle)
    assert.match(
      await readFile(path.join(bundle?.skillsRoot ?? '', 'S46', 'SKILL.md'), 'utf8'),
      /Managed Skill/,
    )
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('SkillSyncManager treats an unchanged installed bundle as a no-op refresh', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'skill-sync-noop-'))

  try {
    const config = loadRunnerHostAppConfig(buildRealRunnerEnv(sandboxRoot))
    const client = new TestSkillSyncClient(
      buildSkillSummary(),
      (releaseId) => buildSkillPayload(releaseId),
    )
    const manager = new SkillSyncManager(
      config,
      client as unknown as RunnerControlApiClient,
    )

    await manager.initialize()
    const changed = await manager.refreshActiveRelease()

    assert.equal(changed, false)
    assert.equal(client.payloadCalls, 1)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('SkillSyncManager degrades on integrity mismatch and clears active availability', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'skill-sync-degraded-'))

  try {
    const config = loadRunnerHostAppConfig(buildRealRunnerEnv(sandboxRoot))
    const client = new TestSkillSyncClient(
      buildSkillSummary(),
      (releaseId) => ({
        ...buildSkillPayload(releaseId),
        skills: [
          {
            ...buildSkillPayload(releaseId).skills[0],
            metaSha256: 'bad-digest',
          },
        ],
      }),
    )
    const manager = new SkillSyncManager(
      config,
      client as unknown as RunnerControlApiClient,
    )

    await manager.initialize()
    const state = manager.getManifestState()

    assert.equal(state.skillSyncStatus, 'degraded')
    assert.equal(state.activeAgentLibraryReleaseId, null)
    assert.deepEqual(state.skillsAvailable, [])
    assert.match(state.skillSyncError ?? '', /digest mismatch|integrity mismatch/i)
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('SkillSyncManager removes failed staging installs instead of promoting partial bundles', async () => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), 'skill-sync-rollback-'))

  try {
    const config = loadRunnerHostAppConfig(buildRealRunnerEnv(sandboxRoot))
    const client = new TestSkillSyncClient(
      buildSkillSummary(),
      (releaseId) => {
        const payload = buildSkillPayload(releaseId)
        const secondMetaJson = `${JSON.stringify(
          { id: 'S47', runtimeDependency: true, providerCompatibility: ['codex'] },
          null,
          2,
        )}\n`

        return {
          ...payload,
          skillCount: 2,
          skills: [
            ...payload.skills,
            {
              skillId: 'S47',
              fingerprint: 'skill-fingerprint-S47',
              relativePath: `config/agents/releases/${releaseId}/skills/S47/SKILL.md`,
              metaJson: secondMetaJson,
              metaSha256: 'bad-digest',
              skillMarkdown: '# Broken Skill\n',
              skillMarkdownSha256: hashSha256('# Broken Skill\n'),
              providerCompatibility: ['codex'],
            },
          ],
        }
      },
    )
    const manager = new SkillSyncManager(
      config,
      client as unknown as RunnerControlApiClient,
    )

    await manager.initialize()

    const releasesRoot = path.join(config.skillCacheRoot, 'releases')
    const stagingRoot = path.join(config.skillCacheRoot, 'staging')

    assert.deepEqual(await readdir(releasesRoot), [])
    assert.deepEqual(await readdir(stagingRoot), [])
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true })
  }
})
