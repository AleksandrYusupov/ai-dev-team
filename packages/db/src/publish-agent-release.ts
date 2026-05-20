import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { stringify } from 'yaml'

import {
  AgentLibraryValidationError,
  loadAgentLibraryBundle,
  resolveAgentConfigFolder,
  resolveAgentReleaseFolder,
  resolveAgentReleaseRoot,
  validateAgentLibraryBundle,
} from './agent-config/manifest-loader.js'

interface PublishCliOptions {
  releaseId: string | undefined
  publishedBy: string
  dryRun: boolean
}

function parseCliArgs(argv: string[]): PublishCliOptions {
  let releaseId: string | undefined
  let publishedBy = 'codex'
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--release-id') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new AgentLibraryValidationError([
          '--release-id must be followed by a release id.',
        ])
      }

      releaseId = nextValue
      index += 1
      continue
    }

    if (value === '--published-by') {
      const nextValue = argv[index + 1]
      if (!nextValue) {
        throw new AgentLibraryValidationError([
          '--published-by must be followed by a publisher string.',
        ])
      }

      publishedBy = nextValue
      index += 1
      continue
    }

    if (value === '--dry-run') {
      dryRun = true
    }
  }

  return { releaseId, publishedBy, dryRun }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function copyWorkingTreeToRelease(baseDir: string, releaseDir: string): Promise<void> {
  for (const entry of [
    'role-charters',
    'system-instructions',
    'skills',
    'skill-packs',
    'prompt-families',
    'provider-overlays',
    'manifests',
  ]) {
    if (await pathExists(path.join(baseDir, entry))) {
      await cp(path.join(baseDir, entry), path.join(releaseDir, entry), {
        recursive: true,
      })
    }
  }
}

function buildReleaseChangelog(input: {
  releaseId: string
  publishedAt: string
  publishedBy: string
  roleCount: number
  skillCount: number
  packCount: number
  promptFamilyCount: number
  predecessorReleaseId: string | null
  rollbackToReleaseId: string | null
  libraryFingerprint: string
}): string {
  return `# Agent Library Release ${input.releaseId}

## Summary
- Status: published
- Published at: ${input.publishedAt}
- Published by: ${input.publishedBy}
- Library fingerprint: ${input.libraryFingerprint}

## Contents
- Roles: ${input.roleCount}
- Skills: ${input.skillCount}
- Skill packs: ${input.packCount}
- Prompt families: ${input.promptFamilyCount}

## Versioning
- Previous release: ${input.predecessorReleaseId ?? 'none'}
- Rollback target: ${input.rollbackToReleaseId ?? 'none'}
- This snapshot is immutable and becomes authoritative for future runtime pinning only in later blocks.

## Change Notes
- Seeded from the current working \`config/agents\` tree.
- Any future content change must publish a new release id instead of mutating this snapshot.
`
}

async function main(): Promise<void> {
  const configuredBaseDir = process.env.AI_DEV_TEAM_AGENT_CONFIG_DIR
  const baseDir = configuredBaseDir
    ? path.resolve(configuredBaseDir)
    : resolveAgentConfigFolder()
  const cli = parseCliArgs(process.argv.slice(2))
  const bundle = await loadAgentLibraryBundle({ baseDir, source: 'working' })
  const result = await validateAgentLibraryBundle(bundle)
  const releaseId = cli.releaseId ?? bundle.library.version

  if (releaseId !== bundle.library.version) {
    throw new AgentLibraryValidationError([
      `Requested release id ${releaseId} does not match working tree library version ${bundle.library.version}.`,
    ])
  }

  const releaseRoot = resolveAgentReleaseRoot(baseDir)
  const releaseDir = resolveAgentReleaseFolder(releaseId, baseDir)
  const releaseManifestPath = path.join(releaseDir, 'release.yaml')
  const releaseExists = await pathExists(releaseManifestPath)

  if (releaseExists) {
    const publishedBundle = await loadAgentLibraryBundle({
      baseDir,
      source: 'release',
      releaseId,
    })
    const publishedResult = await validateAgentLibraryBundle(publishedBundle)

    if (
      publishedResult.fingerprints.libraryFingerprint !==
      result.fingerprints.libraryFingerprint
    ) {
      throw new AgentLibraryValidationError([
        `Release ${releaseId} already exists with different content.`,
      ])
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          created: false,
          dryRun: cli.dryRun,
          noOp: true,
          releaseId,
          releaseDir,
          fingerprint: publishedResult.fingerprints.libraryFingerprint,
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  const predecessorReleaseId =
    bundle.releaseIndex?.releases.at(-1)?.releaseId ?? null
  const rollbackToReleaseId = predecessorReleaseId
  const publishedAt = new Date().toISOString()
  const releaseManifest = {
    release_id: releaseId,
    library_id: bundle.library.libraryId,
    library_version: bundle.library.version,
    published_at: publishedAt,
    published_by: cli.publishedBy,
    changelog_path: 'CHANGELOG.md',
    predecessor_release_id: predecessorReleaseId,
    rollback_to_release_id: rollbackToReleaseId,
    source_library_fingerprint: result.fingerprints.libraryFingerprint,
    fingerprints: {
      library_fingerprint: result.fingerprints.libraryFingerprint,
      skill_fingerprints: result.fingerprints.skillFingerprints,
      skill_pack_fingerprints: result.fingerprints.skillPackFingerprints,
      prompt_family_fingerprints: result.fingerprints.promptFamilyFingerprints,
      prompt_bundle_fingerprints: result.fingerprints.promptBundleFingerprints,
      provider_overlay_fingerprints: result.fingerprints.providerOverlayFingerprints,
      tooling_policy_fingerprint: result.fingerprints.toolingPolicyFingerprint,
    },
  }
  const releaseIndex = {
    library_id: bundle.library.libraryId,
    release_id_pattern: bundle.library.versioningPolicy.releaseIdPattern,
    releases: [
      ...(bundle.releaseIndex?.releases.map((entry) => ({
        release_id: entry.releaseId,
        library_version: entry.libraryVersion,
        release_manifest_path: entry.releaseManifestPath,
        published_at: entry.publishedAt,
        library_fingerprint: entry.libraryFingerprint,
      })) ?? []),
      {
        release_id: releaseId,
        library_version: bundle.library.version,
        release_manifest_path: `${releaseId}/release.yaml`,
        published_at: publishedAt,
        library_fingerprint: result.fingerprints.libraryFingerprint,
      },
    ],
  }

  if (cli.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          created: false,
          dryRun: true,
          noOp: false,
          releaseId,
          releaseDir,
          fingerprint: result.fingerprints.libraryFingerprint,
          predecessorReleaseId,
          rollbackToReleaseId,
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  await mkdir(releaseRoot, { recursive: true })
  await mkdir(releaseDir, { recursive: true })
  await copyWorkingTreeToRelease(baseDir, releaseDir)
  await writeFile(
    releaseManifestPath,
    stringify(releaseManifest, { lineWidth: 0 }),
    'utf8',
  )
  await writeFile(
    path.join(releaseDir, 'CHANGELOG.md'),
    buildReleaseChangelog({
      releaseId,
      publishedAt,
      publishedBy: cli.publishedBy,
      roleCount: result.summary.roleCount,
      skillCount: result.summary.skillCount,
      packCount: result.summary.packCount,
      promptFamilyCount: result.summary.promptFamilyCount,
      predecessorReleaseId,
      rollbackToReleaseId,
      libraryFingerprint: result.fingerprints.libraryFingerprint,
    }),
    'utf8',
  )
  await writeFile(
    path.join(releaseRoot, 'index.yaml'),
    stringify(releaseIndex, { lineWidth: 0 }),
    'utf8',
  )

  const publishedBundle = await loadAgentLibraryBundle({
    baseDir,
    source: 'release',
    releaseId,
  })
  const publishedResult = await validateAgentLibraryBundle(publishedBundle)

  process.stdout.write(
    `${JSON.stringify(
      {
        created: true,
        dryRun: false,
        noOp: false,
        releaseId,
        releaseDir,
        fingerprint: publishedResult.fingerprints.libraryFingerprint,
        predecessorReleaseId,
        rollbackToReleaseId,
      },
      null,
      2,
    )}\n`,
  )
}

main().catch((error: unknown) => {
  if (error instanceof AgentLibraryValidationError) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  }

  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
