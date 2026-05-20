import { setInterval } from 'node:timers'

import { loadRunnerHostAppConfig } from './config.js'

function main(): void {
  const config = loadRunnerHostAppConfig({
    ...process.env,
    RUNNER_RUNTIME_MODE: 'fake',
  })

  console.info('fake-mcp started', {
    runnerNodeId: config.runnerNodeId,
    hostGroupId: config.hostGroupId,
    configHash: config.mcpConfigHash,
  })

  const timer = setInterval(() => {
    console.info('fake-mcp heartbeat', {
      runnerNodeId: config.runnerNodeId,
      publishedAt: new Date().toISOString(),
    })
  }, 60_000)
  timer.unref?.()

  const stop = () => {
    clearInterval(timer)
    process.exit(0)
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main()
