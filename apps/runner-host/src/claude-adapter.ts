import { pathToFileURL } from 'node:url'

import { runClaudeAdapter } from './provider-adapter.js'

export async function main(): Promise<void> {
  await runClaudeAdapter()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error('claude adapter failed', error)
    process.exitCode = 1
  })
}
