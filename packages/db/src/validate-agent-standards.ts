import process from 'node:process'
import path from 'node:path'

import {
  StandardsBundleValidationError,
  loadStandardsBundle,
  resolveAgentStandardsFolder,
  validateStandardsBundle,
} from './standards-config/manifest-loader.js'

async function main(): Promise<void> {
  const configuredBaseDir = process.env.AI_DEV_TEAM_AGENT_STANDARDS_DIR
  const baseDir = configuredBaseDir
    ? path.resolve(configuredBaseDir)
    : resolveAgentStandardsFolder()
  const bundle = await loadStandardsBundle(baseDir)
  const result = await validateStandardsBundle(bundle)

  process.stdout.write(
    `${JSON.stringify(
      {
        configDir: baseDir,
        fingerprint: result.fingerprints.bundleFingerprint,
        fingerprints: result.fingerprints,
        summary: result.summary,
      },
      null,
      2,
    )}\n`,
  )
}

main().catch((error: unknown) => {
  if (error instanceof StandardsBundleValidationError) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  }

  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
