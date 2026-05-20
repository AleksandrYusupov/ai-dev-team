import assert from 'node:assert/strict'
import test from 'node:test'

import { loadExecutionBundleSystemInstruction } from './runners.js'

test('loadExecutionBundleSystemInstruction falls back to working-tree instructions for intake_agent', async () => {
  const instruction = await loadExecutionBundleSystemInstruction({
    releaseId: 'v1',
    roleId: 'intake_agent',
  })

  assert.ok(instruction)
  assert.equal(instruction.roleId, 'intake_agent')
  assert.equal(instruction.resolutionSource, 'working_tree_fallback')
  assert.match(
    instruction.body,
    /You MUST use the Linear MCP to perform these actions directly/,
  )
})

test('loadExecutionBundleSystemInstruction returns null when no role-specific file exists', async () => {
  const instruction = await loadExecutionBundleSystemInstruction({
    releaseId: 'v1',
    roleId: 'build_agent_backend',
  })

  assert.equal(instruction, null)
})
