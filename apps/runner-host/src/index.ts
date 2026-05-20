import type { AgentProvider } from '@ai-dev-team/shared'

import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { loadRunnerHostAppConfig } from './config.js'
import { RunnerHostRuntime } from './runtime.js'

const VALID_PROVIDERS = ['codex', 'claude'] as const

function parseCliArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (!value.startsWith('--')) {
      continue
    }

    const key = value.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      result[key] = true
      continue
    }

    result[key] = next
    index += 1
  }

  return result
}

export function applyProviderOverride(
  config: ReturnType<typeof loadRunnerHostAppConfig>,
  providerOverride: string | null,
): ReturnType<typeof loadRunnerHostAppConfig> {
  if (
    !providerOverride ||
    !VALID_PROVIDERS.includes(providerOverride as (typeof VALID_PROVIDERS)[number])
  ) {
    return config
  }

  return {
    ...config,
    providers: [providerOverride as AgentProvider],
  }
}

export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const config = loadRunnerHostAppConfig(process.env)
  const abortController = new AbortController()

  const providerOverride =
    typeof args.provider === 'string' ? args.provider : null
  const runtimeConfig = applyProviderOverride(config, providerOverride)
  const runtime = new RunnerHostRuntime(runtimeConfig)

  if (providerOverride) {
    console.info('runner-host provider override selected', {
      provider: providerOverride,
    })
  }

  const stop = () => abortController.abort(new Error('runner-host stopped'))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  try {
    if (args['local-smoke'] || args.smoke) {
      await sleep(10)
      await import('./smoke.js').then((module) => module.runSmokeHarness(runtimeConfig))
      return
    }

    await runtime.run(abortController.signal)
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error('runner-host fatal error', error)
    process.exitCode = 1
  })
}
