import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadWorkflowManifestBundle,
  validateWorkflowManifestBundle,
  workflowManifestFingerprint,
} from './manifest-loader.js'

test('loadWorkflowManifestBundle validates the phase 2 workflow bundle', async () => {
  const bundle = await loadWorkflowManifestBundle()
  const result = validateWorkflowManifestBundle(bundle)
  const buildStartRule = result.bundle.transitionRules.find(
    (rule) => rule.ruleId === 'ready_for_build_to_coding_system_build_started',
  )
  const buildPolicy = result.bundle.roleExecutionPolicies.find(
    (policy) => policy.ownerRole === 'build_agent',
  )
  const integrationReadyRule = result.bundle.transitionRules.find(
    (rule) => rule.ruleId === 'planned_to_ready_for_build_integration_verified',
  )
  const integrationPolicy = result.bundle.roleExecutionPolicies.find(
    (policy) => policy.ownerRole === 'integration_agent',
  )
  const compatibilityBuildContract = result.bundle.runtimeRoleContracts.find(
    (contract) => contract.roleId === 'build_agent',
  )
  const backendBuildContract = result.bundle.runtimeRoleContracts.find(
    (contract) => contract.roleId === 'build_agent_backend',
  )

  assert.equal(result.bundle.configSet.configVersion, 4)
  assert.equal(result.summary.statusCount, 16)
  assert.equal(result.summary.canonicalRoleCount, 22)
  assert.equal(result.summary.visibleLinearActorCount, 1)
  assert.equal(result.summary.triggerCount, 29)
  assert.ok(result.summary.transitionRuleCount > 30)
  assert.ok(result.summary.hookCount > 10)
  assert.ok(result.summary.roleExecutionPolicyCount > 5)
  assert.equal(result.summary.runtimeRoleContractCount, 23)
  assert.equal(result.bundle.operatingModel?.visibleLinearSurface.primaryActorRole, 'orchestrator')
  assert.equal(
    result.bundle.operatingModel?.visibleLinearSurface.optionalFutureLinearActors[0],
    'review_agent',
  )
  assert.equal(
    result.bundle.operatingModel?.roles.filter((role) => role.visibleInLinear).length,
    1,
  )
  assert.ok(
    result.bundle.operatingModel?.roles.some(
      (role) => role.roleId === 'build_agent_integrations' && role.wave === 1,
    ),
  )
  assert.ok(
    result.bundle.operatingModel?.roles.some(
      (role) => role.roleId === 'release_agent' && role.wave === 2,
    ),
  )
  assert.ok(
    result.bundle.reasonCodes.some((reasonCode) => reasonCode.category === 'needs'),
  )
  assert.equal(buildStartRule?.openedRunKind, 'build')
  assert.equal(buildPolicy?.primaryProvider, 'codex')
  assert.equal(buildPolicy?.secondaryProvider, 'claude')
  assert.equal(compatibilityBuildContract?.activationMode, 'compatibility_only')
  assert.equal(compatibilityBuildContract?.canonicalRunKind, 'build')
  assert.equal(backendBuildContract?.canonicalRunKind, 'build')
  assert.deepEqual(integrationReadyRule?.requiredArtifactTypes, [
    'integration_smoke_report',
    'integration_go_live_checklist',
  ])
  assert.ok(
    integrationPolicy?.requiredCapabilities.includes('network_docs_allowlist'),
  )
  assert.ok(
    integrationPolicy?.requiredCapabilities.includes('secret_broker'),
  )
  assert.ok(
    integrationPolicy?.requiredCapabilities.includes('integration_lab'),
  )
  assert.match(workflowManifestFingerprint(bundle), /^[a-f0-9]{64}$/)
})

test('validateWorkflowManifestBundle rejects canonical operating-model drift', async () => {
  const bundle = await loadWorkflowManifestBundle()

  const invalidBundle = {
    ...bundle,
    operatingModel: bundle.operatingModel && {
      ...bundle.operatingModel,
      roles: bundle.operatingModel.roles.map((role) =>
        role.roleId === 'review_agent'
          ? { ...role, visibleInLinear: true }
          : role,
      ),
    },
  }

  assert.throws(
    () => validateWorkflowManifestBundle(invalidBundle),
    /exactly one visible Linear actor/,
  )
})

test('workflowManifestFingerprint changes when role execution policy content changes', async () => {
  const bundle = await loadWorkflowManifestBundle()
  const originalFingerprint = workflowManifestFingerprint(bundle)
  const changedBundle = {
    ...bundle,
    roleExecutionPolicies: bundle.roleExecutionPolicies.map((policy, index) =>
      index === 0
        ? {
            ...policy,
            maxProviderFailovers: policy.maxProviderFailovers + 1,
          }
        : policy,
    ),
  }

  assert.notEqual(
    workflowManifestFingerprint(changedBundle),
    originalFingerprint,
  )
})

test('validateWorkflowManifestBundle rejects runtime role contracts for unknown canonical roles', async () => {
  const bundle = await loadWorkflowManifestBundle()
  const invalidBundle = {
    ...bundle,
    runtimeRoleContracts: bundle.runtimeRoleContracts.map((contract, index) =>
      index === 0
        ? {
            ...contract,
            roleId: 'unknown_runtime_role',
            activationMode: 'defined_only' as const,
          }
        : contract,
    ),
  }

  assert.throws(
    () => validateWorkflowManifestBundle(invalidBundle),
    /role_id is missing from operating_model.yaml/,
  )
})

test('validateWorkflowManifestBundle rejects non-build run kinds for build-profile roles', async () => {
  const bundle = await loadWorkflowManifestBundle()
  const invalidBundle = {
    ...bundle,
    runtimeRoleContracts: bundle.runtimeRoleContracts.map((contract) =>
      contract.roleId === 'build_agent_backend'
        ? {
            ...contract,
            canonicalRunKind: 'review' as const,
          }
        : contract,
    ),
  }

  assert.throws(
    () => validateWorkflowManifestBundle(invalidBundle),
    /build-profile roles must declare canonical_run_kind = build/,
  )
})

test('workflowManifestFingerprint changes when runtime role contract content changes', async () => {
  const bundle = await loadWorkflowManifestBundle()
  const originalFingerprint = workflowManifestFingerprint(bundle)
  const changedBundle = {
    ...bundle,
    runtimeRoleContracts: bundle.runtimeRoleContracts.map((contract, index) =>
      index === 0
        ? {
            ...contract,
            requiredOutputArtifactTypes: [
              ...contract.requiredOutputArtifactTypes,
              'extra_runtime_contract_output',
            ],
          }
        : contract,
    ),
  }

  assert.notEqual(
    workflowManifestFingerprint(changedBundle),
    originalFingerprint,
  )
})
