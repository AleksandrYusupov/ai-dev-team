import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdtemp, rm, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  buildStandardsBundleFingerprints,
  loadStandardsBundle,
  resolveAgentStandardsFolder,
  validateStandardsBundle,
} from './manifest-loader.js'

const execFile = promisify(execFileCallback)

test('loadStandardsBundle validates the canonical standards bundle', async () => {
  const bundle = await loadStandardsBundle()
  const result = await validateStandardsBundle(bundle)

  assert.equal(bundle.library.standardsBundleId, 'canonical-agent-standards')
  assert.equal(bundle.library.version, 'v1')
  assert.equal(result.summary.documentCount, 8)
  assert.equal(result.summary.requiredDocumentCount, 8)
  assert.equal(result.summary.projectProfileCount, 1)
  assert.equal(result.summary.repoCount, 1)
  assert.equal(
    result.bundle.layeringPolicy.precedenceOrder.join(' > '),
    'system > project > repository > agent_runtime > provider',
  )
  assert.match(result.fingerprints.bundleFingerprint, /^[a-f0-9]{64}$/)
  assert.match(
    result.fingerprints.documentFingerprints.rulebook,
    /^[a-f0-9]{64}$/,
  )
})

test('validateStandardsBundle rejects missing referenced documents', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-standards-fixture-'))
  const fixtureDir = path.join(tempDir, 'agent-standards')
  const rulesExamplesDir = path.join(tempDir, 'building_agents', 'rules_examples')

  try {
    await cp(resolveAgentStandardsFolder(), fixtureDir, { recursive: true })
    await cp(
      path.resolve(resolveAgentStandardsFolder(), '..', '..', 'building_agents', 'rules_examples'),
      rulesExamplesDir,
      { recursive: true },
    )

    await unlink(path.join(rulesExamplesDir, '06_OBSIDIAN_DOCS_PROTOCOL.md'))

    await assert.rejects(
      () => loadStandardsBundle(fixtureDir).then((bundle) => validateStandardsBundle(bundle)),
      /ENOENT|no such file/i,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('validate-agent-standards CLI succeeds for the canonical bundle', async () => {
  const cliPath = fileURLToPath(new URL('../validate-agent-standards.js', import.meta.url))
  const { stdout } = await execFile(process.execPath, [cliPath], {
    env: process.env,
  })
  const result = JSON.parse(stdout) as {
    fingerprint: string
    summary: { documentCount: number; projectProfileCount: number }
  }

  assert.match(result.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(result.summary.documentCount, 8)
  assert.equal(result.summary.projectProfileCount, 1)
})

test('buildStandardsBundleFingerprints changes when a project profile changes', async () => {
  const bundle = await loadStandardsBundle()
  const original = buildStandardsBundleFingerprints(bundle)
  const changed = buildStandardsBundleFingerprints({
    ...bundle,
    projectProfiles: bundle.projectProfiles.map((profile) =>
      profile.projectId === 'ai_dev_team'
        ? { ...profile, changelogNote: `${profile.changelogNote}_v2` }
        : profile,
    ),
  })

  assert.notEqual(changed.bundleFingerprint, original.bundleFingerprint)
  assert.notEqual(
    changed.projectProfileFingerprints.ai_dev_team,
    original.projectProfileFingerprints.ai_dev_team,
  )
})
