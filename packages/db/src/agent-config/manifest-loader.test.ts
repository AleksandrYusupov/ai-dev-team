import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  agentLibraryFingerprint,
  buildAgentLibraryFingerprints,
  loadAgentLibraryBundle,
  resolveAgentConfigFolder,
  validateAgentLibraryBundle,
} from './manifest-loader.js'

const execFile = promisify(execFileCallback)

function nextVersionId(version: string): string {
  const match = /^v(\d+)$/u.exec(version)

  if (!match) {
    throw new Error(`Unsupported release version format: ${version}`)
  }

  return `v${(Number(match[1]) + 1).toString()}`
}

test('loadAgentLibraryBundle validates the canonical agent library bundle', async () => {
  const bundle = await loadAgentLibraryBundle()
  const result = await validateAgentLibraryBundle(bundle)
  const releaseBundle = await loadAgentLibraryBundle({
    baseDir: resolveAgentConfigFolder(),
    source: 'release',
    releaseId: 'v3',
  })
  const releaseResult = await validateAgentLibraryBundle(releaseBundle)
  const orchestrator = result.bundle.roleCharters.find(
    (role) => role.frontmatter.roleId === 'orchestrator',
  )
  const planAgent = result.bundle.roleCharters.find(
    (role) => role.frontmatter.roleId === 'plan_agent',
  )
  const integrationAgent = result.bundle.roleCharters.find(
    (role) => role.frontmatter.roleId === 'integration_agent',
  )
  const foundationSkill = result.bundle.skills.find((skill) => skill.meta.id === 'F01')
  const referenceSkill = result.bundle.skills.find((skill) => skill.meta.id === 'R01')
  const integrationSkill = result.bundle.skills.find((skill) => skill.meta.id === 'S46')
  const integrationRule = result.bundle.routingSkillPackMap.find(
    (rule) => rule.ruleId === 'task_type_integration_adds_integration_packs',
  )
  const firstFingerprint = agentLibraryFingerprint(result.bundle)
  const secondFingerprint = agentLibraryFingerprint(await loadAgentLibraryBundle())

  assert.equal(result.summary.roleCount, 22)
  assert.equal(result.summary.skillCount, 77)
  assert.equal(result.summary.packCount, 22)
  assert.equal(result.summary.promptFamilyCount, 8)
  assert.equal(result.summary.providerOverlayCount, 2)
  assert.equal(result.summary.rolePackMapCount, 22)
  assert.equal(result.summary.routingRuleCount, 11)
  assert.equal(result.summary.roleToolPolicyCount, 22)
  assert.equal(result.summary.providerToolPolicyCount, 2)
  assert.equal(result.summary.referenceOnlySkillCount, 11)
  assert.equal(result.summary.integrationSensitiveSkillCount, 9)
  assert.equal(result.summary.riskySkillCount, 21)
  assert.match(firstFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(secondFingerprint, firstFingerprint)
  assert.equal(releaseResult.fingerprints.libraryFingerprint, firstFingerprint)
  assert.equal(orchestrator?.frontmatter.visibleInLinear, true)
  assert.equal(planAgent?.frontmatter.category, 'planning')
  assert.equal(planAgent?.frontmatter.canonicalRunKind, null)
  assert.equal(integrationAgent?.frontmatter.category, 'planning')
  assert.equal(integrationAgent?.frontmatter.canonicalRunKind, null)
  assert.equal(foundationSkill?.meta.kind, 'foundation')
  assert.equal(referenceSkill?.meta.referenceOnlyDefault, true)
  assert.equal(referenceSkill?.meta.runtimeDependency, false)
  assert.equal(integrationSkill?.meta.sensitivityClass, 'credential_boundary')
  assert.ok(
    integrationSkill?.meta.deniedActions.some((action) =>
      action.includes('metadata plane and credential plane'),
    ),
  )
  assert.equal(integrationRule?.requiresIntegration, true)
  assert.equal(result.bundle.library.version, 'v3')
  assert.equal(result.bundle.library.expectedProviderOverlayCount, 2)
  assert.equal(result.bundle.providerOverlays.length, 2)
  assert.equal(result.bundle.toolingPolicy?.providerToolPolicies.length, 2)
})

test('validateAgentLibraryBundle rejects silent working-tree drift without a version bump', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-config-drift-'))
  const fixtureDir = path.join(tempDir, 'agents')
  const currentVersion = (await loadAgentLibraryBundle()).library.version

  try {
    await cp(resolveAgentConfigFolder(), fixtureDir, { recursive: true })

    const skillMetaPath = path.join(fixtureDir, 'skills', 'S41', 'meta.json')
    const skillMeta = JSON.parse(await readFile(skillMetaPath, 'utf8')) as {
      description: string
    }
    skillMeta.description = `${skillMeta.description} drift`
    await writeFile(skillMetaPath, `${JSON.stringify(skillMeta, null, 2)}\n`, 'utf8')

    await assert.rejects(
      () =>
        loadAgentLibraryBundle({
          baseDir: fixtureDir,
          source: 'working',
        }).then((bundle) => validateAgentLibraryBundle(bundle)),
      new RegExp(`diverges from published release ${currentVersion}`),
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('validateAgentLibraryBundle rejects missing role coverage', async () => {
  const bundle = await loadAgentLibraryBundle()
  const invalidBundle = {
    ...bundle,
    roleCharters: bundle.roleCharters.filter(
      (role) => role.frontmatter.roleId !== 'review_agent',
    ),
  }

  await assert.rejects(
    () => validateAgentLibraryBundle(invalidBundle),
    /Missing role charter for workflow role review_agent/,
  )
})

test('validateAgentLibraryBundle rejects unknown routing task types', async () => {
  const bundle = await loadAgentLibraryBundle()
  const invalidBundle = {
    ...bundle,
    routingSkillPackMap: bundle.routingSkillPackMap.map((rule) =>
      rule.ruleId === 'task_type_release_adds_release_and_monitoring_packs'
        ? {
            ...rule,
            taskTypes: ['type/not-real'],
          }
        : rule,
    ),
  }

  await assert.rejects(
    () => validateAgentLibraryBundle(invalidBundle),
    /references unknown task_type type\/not-real/,
  )
})

test('validateAgentLibraryBundle rejects missing integration activation guards', async () => {
  const bundle = await loadAgentLibraryBundle()
  const invalidBundle = {
    ...bundle,
    routingSkillPackMap: bundle.routingSkillPackMap.map((rule) =>
      rule.ruleId === 'task_type_integration_adds_integration_packs'
        ? {
            ...rule,
            requiresIntegration: null,
          }
        : rule,
    ),
  }

  await assert.rejects(
    () => validateAgentLibraryBundle(invalidBundle),
    /must set requires_integration=true when activating integration packs/,
  )
})

test('validateAgentLibraryBundle rejects missing provider tooling coverage in v2', async () => {
  const bundle = await loadAgentLibraryBundle()
  const invalidBundle = {
    ...bundle,
    toolingPolicy: {
      roleToolPolicies: bundle.toolingPolicy?.roleToolPolicies ?? [],
      providerToolPolicies:
        bundle.toolingPolicy?.providerToolPolicies.filter(
          (policy) => policy.provider !== 'claude',
        ) ?? [],
    },
  }

  await assert.rejects(
    () => validateAgentLibraryBundle(invalidBundle),
    /Missing provider tooling policy for provider claude/,
  )
})

test('agentLibraryFingerprint changes when pack references change', async () => {
  const bundle = await loadAgentLibraryBundle()
  const originalFingerprint = agentLibraryFingerprint(bundle)
  const originalFingerprints = buildAgentLibraryFingerprints(bundle)
  const changedBundle = {
    ...bundle,
    skillPacks: bundle.skillPacks.map((pack) =>
      pack.packId === 'build_backend_core'
        ? {
            ...pack,
            skillRefs: [...pack.skillRefs, 'R01'],
          }
        : pack,
    ),
  }
  const changedFingerprints = buildAgentLibraryFingerprints(changedBundle)

  assert.notEqual(agentLibraryFingerprint(changedBundle), originalFingerprint)
  assert.notEqual(
    changedFingerprints.skillPackFingerprints.build_backend_core,
    originalFingerprints.skillPackFingerprints.build_backend_core,
  )
  assert.notEqual(
    changedFingerprints.promptBundleFingerprints.build_agent_backend,
    originalFingerprints.promptBundleFingerprints.build_agent_backend,
  )
})

test('validate-agent-config CLI succeeds for the canonical bundle and fails for a broken fixture', async () => {
  const cliPath = fileURLToPath(new URL('../validate-agent-config.js', import.meta.url))
  const { stdout } = await execFile(process.execPath, [cliPath], {
    env: process.env,
  })
  const successResult = JSON.parse(stdout) as {
    fingerprint: string
    summary: { roleCount: number; skillCount: number }
  }

  assert.match(successResult.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(successResult.summary.roleCount, 22)
  assert.equal(successResult.summary.skillCount, 77)

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-config-fixture-'))
  const brokenConfigDir = path.join(tempDir, 'agents')

  try {
    await cp(resolveAgentConfigFolder(), brokenConfigDir, { recursive: true })

    const brokenRoutingPath = path.join(
      brokenConfigDir,
      'manifests',
      'routing-skill-pack-map.yaml',
    )
    const brokenRoutingContent = await readFile(brokenRoutingPath, 'utf8')

    await writeFile(
      brokenRoutingPath,
      brokenRoutingContent.replace(
        '- build_integrations_core',
        '- unknown_integration_pack',
      ),
      'utf8',
    )

    await assert.rejects(
      execFile(process.execPath, [cliPath], {
        env: {
          ...process.env,
          AI_DEV_TEAM_AGENT_CONFIG_DIR: brokenConfigDir,
        },
      }),
      /references unknown skill pack unknown_integration_pack/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('publish-agent-release CLI is idempotent for an existing release and can publish a new one', async () => {
  const publishCliPath = fileURLToPath(
    new URL('../publish-agent-release.js', import.meta.url),
  )
  const validateReleaseCliPath = fileURLToPath(
    new URL('../validate-agent-release.js', import.meta.url),
  )
  const currentVersion = (await loadAgentLibraryBundle()).library.version
  const nextVersion = nextVersionId(currentVersion)

  const { stdout: noOpStdout } = await execFile(process.execPath, [publishCliPath], {
    env: process.env,
  })
  const noOpResult = JSON.parse(noOpStdout) as {
    created: boolean
    noOp: boolean
    releaseId: string
  }

  assert.equal(noOpResult.created, false)
  assert.equal(noOpResult.noOp, true)
  assert.equal(noOpResult.releaseId, currentVersion)

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-release-publish-'))
  const fixtureDir = path.join(tempDir, 'agents')

  try {
    await cp(resolveAgentConfigFolder(), fixtureDir, { recursive: true })

    const libraryManifestPath = path.join(fixtureDir, 'manifests', 'library.yaml')
    const libraryManifest = await readFile(libraryManifestPath, 'utf8')
    await writeFile(
      libraryManifestPath,
      libraryManifest.replace(`version: ${currentVersion}`, `version: ${nextVersion}`),
      'utf8',
    )

    const skillDocPath = path.join(fixtureDir, 'skills', 'S41', 'SKILL.md')
    await writeFile(
      skillDocPath,
      `${(await readFile(skillDocPath, 'utf8')).trim()}\n- Added for release v2 test.\n`,
      'utf8',
    )

    const { stdout: publishStdout } = await execFile(
      process.execPath,
      [publishCliPath, '--release-id', nextVersion, '--published-by', 'test-suite'],
      {
        env: {
          ...process.env,
          AI_DEV_TEAM_AGENT_CONFIG_DIR: fixtureDir,
        },
      },
    )
    const publishResult = JSON.parse(publishStdout) as {
      created: boolean
      releaseId: string
    }

    assert.equal(publishResult.created, true)
    assert.equal(publishResult.releaseId, nextVersion)

    const { stdout: validateStdout } = await execFile(
      process.execPath,
      [validateReleaseCliPath, '--release-id', nextVersion],
      {
        env: {
          ...process.env,
          AI_DEV_TEAM_AGENT_CONFIG_DIR: fixtureDir,
        },
      },
    )
    const validateResult = JSON.parse(validateStdout) as {
      releaseId: string
      fingerprint: string
    }

    assert.equal(validateResult.releaseId, nextVersion)
    assert.match(validateResult.fingerprint, /^[a-f0-9]{64}$/)
    assert.equal(
      await readFile(
        path.join(
          fixtureDir,
          'releases',
          nextVersion,
          'system-instructions',
          'intake_agent_system_instructions.md',
        ),
        'utf8',
      ).then(() => true),
      true,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('validate-agent-release CLI rejects a release with a missing changelog', async () => {
  const validateReleaseCliPath = fileURLToPath(
    new URL('../validate-agent-release.js', import.meta.url),
  )
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-release-validate-'))
  const fixtureDir = path.join(tempDir, 'agents')

  try {
    await cp(resolveAgentConfigFolder(), fixtureDir, { recursive: true })
    await rm(path.join(fixtureDir, 'releases', 'v1', 'CHANGELOG.md'), { force: true })

    await assert.rejects(
      execFile(process.execPath, [validateReleaseCliPath, '--release-id', 'v1'], {
        env: {
          ...process.env,
          AI_DEV_TEAM_AGENT_CONFIG_DIR: fixtureDir,
        },
      }),
      /Release changelog could not be read for v1/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
