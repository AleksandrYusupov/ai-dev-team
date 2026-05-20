import process from 'node:process'
import path from 'node:path'

import {
  AgentLibraryValidationError,
  loadAgentLibraryBundle,
  resolveAgentConfigFolder,
  validateAgentLibraryBundle,
} from './agent-config/manifest-loader.js'

function parseCliArgs(argv: string[]): {
  source: 'working' | 'release'
  releaseId: string | undefined
} {
  let source: 'working' | 'release' = 'working'
  let releaseId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--source') {
      const nextValue = argv[index + 1]
      if (nextValue === 'working' || nextValue === 'release') {
        source = nextValue
        index += 1
        continue
      }

      throw new AgentLibraryValidationError([
        '--source must be followed by "working" or "release".',
      ])
    }

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
  }

  if (source === 'release' && !releaseId) {
    throw new AgentLibraryValidationError([
      '--release-id is required when --source=release.',
    ])
  }

  return { source, releaseId }
}

async function main(): Promise<void> {
  const configuredBaseDir = process.env.AI_DEV_TEAM_AGENT_CONFIG_DIR
  const baseDir = configuredBaseDir
    ? path.resolve(configuredBaseDir)
    : resolveAgentConfigFolder()
  const { source, releaseId } = parseCliArgs(process.argv.slice(2))
  const bundle = await loadAgentLibraryBundle({
    baseDir,
    source,
    releaseId,
  })
  const result = await validateAgentLibraryBundle(bundle)

  process.stdout.write(
    `${JSON.stringify(
      {
        configDir: baseDir,
        source,
        releaseId: bundle.releaseId,
        fingerprint: result.fingerprints.libraryFingerprint,
        fingerprints: result.fingerprints,
        summary: result.summary,
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
