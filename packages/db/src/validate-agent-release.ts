import process from 'node:process'
import path from 'node:path'

import {
  AgentLibraryValidationError,
  loadAgentLibraryBundle,
  resolveAgentConfigFolder,
  validateAgentLibraryBundle,
} from './agent-config/manifest-loader.js'

function parseCliArgs(argv: string[]): { releaseId: string } {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--release-id') {
      const releaseId = argv[index + 1]
      if (!releaseId) {
        break
      }

      return { releaseId }
    }
  }

  throw new AgentLibraryValidationError([
    '--release-id is required when validating a published release.',
  ])
}

async function main(): Promise<void> {
  const configuredBaseDir = process.env.AI_DEV_TEAM_AGENT_CONFIG_DIR
  const baseDir = configuredBaseDir
    ? path.resolve(configuredBaseDir)
    : resolveAgentConfigFolder()
  const { releaseId } = parseCliArgs(process.argv.slice(2))
  const bundle = await loadAgentLibraryBundle({
    baseDir,
    source: 'release',
    releaseId,
  })
  const result = await validateAgentLibraryBundle(bundle)

  process.stdout.write(
    `${JSON.stringify(
      {
        configDir: baseDir,
        source: 'release',
        releaseId,
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
