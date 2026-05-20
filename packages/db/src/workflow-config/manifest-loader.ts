import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDocument } from 'yaml'
import { z } from 'zod'

import {
  AGENT_PROVIDERS,
  ACTOR_TYPES,
  ARTIFACT_SCOPES,
  EFFECT_ON_LEASES,
  EFFECT_ON_RUNS,
  HOOK_FAILURE_MODES,
  HOOK_TYPES,
  LINEAR_PROJECT_UPDATE_HEALTHS,
  LINEAR_SYNC_MILESTONE_EVENT_CODES,
  PROVIDER_FALLBACK_REASONS,
  RUNTIME_ROLE_ACTIVATION_MODES,
  RUNTIME_ROLE_HUMAN_GATE_MODES,
  RUN_KINDS,
  WORKFLOW_CONFIG_SET_STATUSES,
} from '@ai-dev-team/shared'

import type {
  WorkflowManifestBundle,
  WorkflowManifestValidationResult,
} from './types.js'

export class WorkflowManifestValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Workflow manifest validation failed:\n${issues.join('\n')}`)
    this.name = 'WorkflowManifestValidationError'
  }
}

const configSetSchema = z.object({
  config_version: z.number().int().positive(),
  status: z.enum(WORKFLOW_CONFIG_SET_STATUSES),
  is_active_for_new_runs: z.boolean(),
  notes: z.string().trim().min(1).nullable().default(null),
})

const statusSchema = z.object({
  code: z.string().trim().min(1),
  label: z.string().trim().min(1),
  group: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  is_terminal: z.boolean(),
  manual_entry_allowed: z.boolean(),
  manual_exit_allowed: z.boolean(),
  requires_human: z.boolean(),
  blocks_execution: z.boolean(),
  sort_order: z.number().int().positive(),
  description: z.string().trim().min(1),
})

const triggerSchema = z.object({
  code: z.string().trim().min(1),
  actor_type: z.enum(ACTOR_TYPES),
  is_manual: z.boolean(),
  requires_comment: z.boolean(),
  requires_artifact: z.boolean(),
  description: z.string().trim().min(1),
})

const transitionRuleSchema = z.object({
  rule_id: z.string().trim().min(1),
  from_status: z.string().trim().min(1),
  to_status: z.string().trim().min(1),
  trigger_code: z.string().trim().min(1),
  owner_role: z.string().trim().min(1),
  allowed_actor_types: z.array(z.enum(ACTOR_TYPES)).nonempty(),
  guard_conditions: z.array(z.string().trim().min(1)),
  required_artifact_types: z.array(z.string().trim().min(1)),
  artifact_scope: z.enum(ARTIFACT_SCOPES),
  requires_reason_code: z.boolean(),
  requires_checkpoint: z.boolean(),
  requires_active_run: z.boolean(),
  requires_human_approval: z.boolean(),
  effect_on_run: z.enum(EFFECT_ON_RUNS),
  opened_run_kind: z.enum(RUN_KINDS).nullable().default(null),
  effect_on_lease: z.enum(EFFECT_ON_LEASES),
  notes: z.string().trim().min(1),
})

const statusEntryHookSchema = z.object({
  status_code: z.string().trim().min(1),
  hook_order: z.number().int().positive(),
  hook_type: z.enum(HOOK_TYPES),
  hook_name: z.string().trim().min(1),
  owner_role: z.string().trim().min(1),
  target_owner_role: z.string().trim().min(1).nullable().default(null),
  is_required: z.boolean(),
  failure_mode: z.enum(HOOK_FAILURE_MODES),
  produces_artifact_type: z.string().trim().min(1).nullable().default(null),
  emits_command_type: z.string().trim().min(1).nullable().default(null),
  notes: z.string().trim().min(1),
})

const reasonCodeSchema = z.object({
  code: z.string().trim().min(1),
  category: z.string().trim().min(1),
  description: z.string().trim().min(1),
  allowed_on_transitions: z.array(z.string().trim().min(1)).nonempty(),
})

const roleExecutionPolicySchema = z.object({
  owner_role: z.string().trim().min(1),
  primary_provider: z.enum(AGENT_PROVIDERS),
  secondary_provider: z.enum(AGENT_PROVIDERS),
  fallback_triggers: z
    .array(z.enum(PROVIDER_FALLBACK_REASONS))
    .nonempty(),
  max_provider_failovers: z.number().int().min(0),
  mcp_profile_ref: z.string().trim().min(1),
  required_capabilities: z.array(z.string().trim().min(1)),
})

const runtimeRoleHumanGatePolicySchema = z.object({
  mode: z.enum(RUNTIME_ROLE_HUMAN_GATE_MODES),
  required_human_owned_zones: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().min(1).nullable().default(null),
})

const runtimeRoleContractSchema = z.object({
  role_id: z.string().trim().min(1),
  canonical_run_kind: z.enum(RUN_KINDS).nullable().default(null),
  allowed_status_ownership: z.array(z.string().trim().min(1)).nonempty(),
  required_input_artifact_types: z.array(z.string().trim().min(1)).default([]),
  required_output_artifact_types: z.array(z.string().trim().min(1)).default([]),
  human_gate_policy: runtimeRoleHumanGatePolicySchema,
  escalation_reason_codes: z.array(z.string().trim().min(1)).default([]),
  activation_mode: z.enum(RUNTIME_ROLE_ACTIVATION_MODES),
})

const operatingModelRoleSchema = z.object({
  role_id: z.string().trim().min(1),
  wave: z.number().int().min(1),
  category: z.string().trim().min(1),
  visible_in_linear: z.boolean(),
})

const operatingModelSchema = z.object({
  roles: z.array(operatingModelRoleSchema).nonempty(),
  visible_linear_surface: z.object({
    primary_actor_role: z.string().trim().min(1),
    optional_future_linear_actors: z.array(z.string().trim().min(1)),
  }),
  human_owned_zones: z.array(z.string().trim().min(1)).nonempty(),
  taxonomy: z.object({
    label_groups: z.object({
      type: z.array(z.string().trim().min(1)).nonempty(),
      risk: z.array(z.string().trim().min(1)).nonempty(),
      source: z.array(z.string().trim().min(1)).nonempty(),
      mode: z.array(z.string().trim().min(1)).nonempty(),
      human: z.array(z.string().trim().min(1)).nonempty(),
    }),
    reason_code_groups: z.object({
      needs: z.array(z.string().trim().min(1)).nonempty(),
      blocked: z.array(z.string().trim().min(1)).nonempty(),
      rework: z.array(z.string().trim().min(1)).nonempty(),
    }),
  }),
})

const linearStateMappingSchema = z.object({
  status_code: z.string().trim().min(1),
  linear_state_name: z.string().trim().min(1).nullable().default(null),
  sync_enabled: z.boolean().default(true),
})

const linearMilestonePolicySchema = z.object({
  event_code: z.enum(LINEAR_SYNC_MILESTONE_EVENT_CODES),
  event_label: z.string().trim().min(1),
  post_comment: z.boolean().default(true),
  create_project_update: z.boolean().default(false),
  project_update_health: z.enum(LINEAR_PROJECT_UPDATE_HEALTHS).nullable().default(null),
})

function normalizeFieldErrors(
  prefix: string,
  issues: z.ZodIssue[],
  collector: string[],
): void {
  for (const issue of issues) {
    const location = issue.path.length > 0 ? issue.path.join('.') : '<root>'
    collector.push(`${prefix} ${location}: ${issue.message}`)
  }
}

function ensureUnique(
  values: string[],
  label: string,
  collector: string[],
): void {
  const seen = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      collector.push(`Duplicate ${label}: ${value}`)
      continue
    }

    seen.add(value)
  }
}

function parseYamlValue(filePath: string, label: string): unknown {
  return readFile(filePath, 'utf8').then((content) => {
    const document = parseDocument(content)
    const issues: string[] = []

    for (const error of document.errors) {
      issues.push(`${label}: ${error.message}`)
    }

    for (const warning of document.warnings) {
      issues.push(`${label}: ${warning.message}`)
    }

    if (issues.length > 0) {
      throw new WorkflowManifestValidationError(issues)
    }

    return document.toJS()
  })
}

export function resolveWorkflowConfigFolder(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'config/workflow',
  )
}

export async function loadWorkflowManifestBundle(
  baseDir: string = resolveWorkflowConfigFolder(),
): Promise<WorkflowManifestBundle> {
  const issues: string[] = []

  const [
    configSetRaw,
    statusesRaw,
    triggersRaw,
    transitionRulesRaw,
    statusEntryHooksRaw,
    reasonCodesRaw,
    roleExecutionPoliciesRaw,
    runtimeRoleContractsRaw,
    operatingModelRaw,
    linearSyncRaw,
  ] = await Promise.all([
    parseYamlValue(path.join(baseDir, 'config_sets.yaml'), 'config_sets.yaml'),
    parseYamlValue(
      path.join(baseDir, 'status_catalog.yaml'),
      'status_catalog.yaml',
    ),
    parseYamlValue(
      path.join(baseDir, 'trigger_catalog.yaml'),
      'trigger_catalog.yaml',
    ),
    parseYamlValue(
      path.join(baseDir, 'transition_rules.yaml'),
      'transition_rules.yaml',
    ),
    parseYamlValue(
      path.join(baseDir, 'status_entry_hooks.yaml'),
      'status_entry_hooks.yaml',
    ),
    parseYamlValue(path.join(baseDir, 'reason_codes.yaml'), 'reason_codes.yaml'),
    parseYamlValue(
      path.join(baseDir, 'role_execution_policies.yaml'),
      'role_execution_policies.yaml',
    ),
    parseYamlValue(
      path.join(baseDir, 'runtime_role_contracts.yaml'),
      'runtime_role_contracts.yaml',
    ),
    parseYamlValue(
      path.join(baseDir, 'operating_model.yaml'),
      'operating_model.yaml',
    ),
    parseYamlValue(path.join(baseDir, 'linear_sync.yaml'), 'linear_sync.yaml'),
  ])

  const configSetResult = z.array(configSetSchema).length(1).safeParse(configSetRaw)
  const statusesResult = z.array(statusSchema).nonempty().safeParse(statusesRaw)
  const triggersResult = z.array(triggerSchema).nonempty().safeParse(triggersRaw)
  const transitionRulesResult = z
    .array(transitionRuleSchema)
    .nonempty()
    .safeParse(transitionRulesRaw)
  const hooksResult = z
    .array(statusEntryHookSchema)
    .nonempty()
    .safeParse(statusEntryHooksRaw)
  const reasonCodesResult = z
    .array(reasonCodeSchema)
    .nonempty()
    .safeParse(reasonCodesRaw)
  const roleExecutionPoliciesResult = z
    .array(roleExecutionPolicySchema)
    .nonempty()
    .safeParse(roleExecutionPoliciesRaw)
  const runtimeRoleContractsResult = z
    .array(runtimeRoleContractSchema)
    .nonempty()
    .safeParse(runtimeRoleContractsRaw)
  const operatingModelResult = operatingModelSchema.safeParse(operatingModelRaw)
  const linearSyncResult = z
    .object({
      statuses: z.array(linearStateMappingSchema).nonempty(),
      milestones: z.array(linearMilestonePolicySchema).nonempty(),
    })
    .safeParse(linearSyncRaw)

  if (!configSetResult.success) {
    normalizeFieldErrors('config_sets.yaml', configSetResult.error.issues, issues)
  }
  if (!statusesResult.success) {
    normalizeFieldErrors('status_catalog.yaml', statusesResult.error.issues, issues)
  }
  if (!triggersResult.success) {
    normalizeFieldErrors('trigger_catalog.yaml', triggersResult.error.issues, issues)
  }
  if (!transitionRulesResult.success) {
    normalizeFieldErrors(
      'transition_rules.yaml',
      transitionRulesResult.error.issues,
      issues,
    )
  }
  if (!hooksResult.success) {
    normalizeFieldErrors(
      'status_entry_hooks.yaml',
      hooksResult.error.issues,
      issues,
    )
  }
  if (!reasonCodesResult.success) {
    normalizeFieldErrors('reason_codes.yaml', reasonCodesResult.error.issues, issues)
  }
  if (!roleExecutionPoliciesResult.success) {
    normalizeFieldErrors(
      'role_execution_policies.yaml',
      roleExecutionPoliciesResult.error.issues,
      issues,
    )
  }
  if (!runtimeRoleContractsResult.success) {
    normalizeFieldErrors(
      'runtime_role_contracts.yaml',
      runtimeRoleContractsResult.error.issues,
      issues,
    )
  }
  if (!operatingModelResult.success) {
    normalizeFieldErrors('operating_model.yaml', operatingModelResult.error.issues, issues)
  }
  if (!linearSyncResult.success) {
    normalizeFieldErrors('linear_sync.yaml', linearSyncResult.error.issues, issues)
  }

  if (issues.length > 0) {
    throw new WorkflowManifestValidationError(issues)
  }

  const configSetRows = configSetResult.data ?? []
  const statusRows = statusesResult.data ?? []
  const triggerRows = triggersResult.data ?? []
  const transitionRuleRows = transitionRulesResult.data ?? []
  const hookRows = hooksResult.data ?? []
  const reasonCodeRows = reasonCodesResult.data ?? []
  const roleExecutionPolicyRows = roleExecutionPoliciesResult.data ?? []
  const runtimeRoleContractRows = runtimeRoleContractsResult.data ?? []
  const operatingModel = operatingModelResult.success
    ? operatingModelResult.data
    : null
  const linearStateMappingRows = linearSyncResult.success
    ? linearSyncResult.data.statuses
    : []
  const linearMilestonePolicyRows = linearSyncResult.success
    ? linearSyncResult.data.milestones
    : []

  if (configSetRows.length !== 1) {
    throw new WorkflowManifestValidationError([
      'config_sets.yaml must contain exactly one config set row',
    ])
  }
  const configSet = configSetRows[0]

  return {
    configSet: {
      configVersion: configSet.config_version,
      status: configSet.status,
      isActiveForNewRuns: configSet.is_active_for_new_runs,
      notes: configSet.notes,
    },
    statuses: statusRows.map((row) => ({
      code: row.code,
      label: row.label,
      group: row.group,
      kind: row.kind,
      isTerminal: row.is_terminal,
      manualEntryAllowed: row.manual_entry_allowed,
      manualExitAllowed: row.manual_exit_allowed,
      requiresHuman: row.requires_human,
      blocksExecution: row.blocks_execution,
      sortOrder: row.sort_order,
      description: row.description,
    })),
    triggers: triggerRows.map((row) => ({
      code: row.code,
      actorType: row.actor_type,
      isManual: row.is_manual,
      requiresComment: row.requires_comment,
      requiresArtifact: row.requires_artifact,
      description: row.description,
    })),
    transitionRules: transitionRuleRows.map((row) => ({
      ruleId: row.rule_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      triggerCode: row.trigger_code,
      ownerRole: row.owner_role,
      allowedActorTypes: row.allowed_actor_types,
      guardConditions: row.guard_conditions,
      requiredArtifactTypes: row.required_artifact_types,
      artifactScope: row.artifact_scope,
      requiresReasonCode: row.requires_reason_code,
      requiresCheckpoint: row.requires_checkpoint,
      requiresActiveRun: row.requires_active_run,
      requiresHumanApproval: row.requires_human_approval,
      effectOnRun: row.effect_on_run,
      openedRunKind: row.opened_run_kind,
      effectOnLease: row.effect_on_lease,
      notes: row.notes,
    })),
    statusEntryHooks: hookRows.map((row) => ({
      statusCode: row.status_code,
      hookOrder: row.hook_order,
      hookType: row.hook_type,
      hookName: row.hook_name,
      ownerRole: row.owner_role,
      targetOwnerRole: row.target_owner_role,
      isRequired: row.is_required,
      failureMode: row.failure_mode,
      producesArtifactType: row.produces_artifact_type,
      emitsCommandType: row.emits_command_type,
      notes: row.notes,
    })),
    reasonCodes: reasonCodeRows.map((row) => ({
      code: row.code,
      category: row.category,
      description: row.description,
      allowedOnTransitions: row.allowed_on_transitions,
    })),
    roleExecutionPolicies: roleExecutionPolicyRows.map((row) => ({
      ownerRole: row.owner_role,
      primaryProvider: row.primary_provider,
      secondaryProvider: row.secondary_provider,
      fallbackTriggers: row.fallback_triggers,
      maxProviderFailovers: row.max_provider_failovers,
      mcpProfileRef: row.mcp_profile_ref,
      requiredCapabilities: row.required_capabilities,
    })),
    runtimeRoleContracts: runtimeRoleContractRows.map((row) => ({
      roleId: row.role_id,
      canonicalRunKind: row.canonical_run_kind,
      allowedStatusOwnership: row.allowed_status_ownership,
      requiredInputArtifactTypes: row.required_input_artifact_types,
      requiredOutputArtifactTypes: row.required_output_artifact_types,
      humanGatePolicy: {
        mode: row.human_gate_policy.mode,
        requiredHumanOwnedZones: row.human_gate_policy.required_human_owned_zones,
        notes: row.human_gate_policy.notes,
      },
      escalationReasonCodes: row.escalation_reason_codes,
      activationMode: row.activation_mode,
    })),
    operatingModel:
      operatingModel === null
        ? undefined
        : {
            roles: operatingModel.roles.map((role) => ({
              roleId: role.role_id,
              wave: role.wave,
              category: role.category,
              visibleInLinear: role.visible_in_linear,
            })),
            visibleLinearSurface: {
              primaryActorRole: operatingModel.visible_linear_surface.primary_actor_role,
              optionalFutureLinearActors:
                operatingModel.visible_linear_surface.optional_future_linear_actors,
            },
            humanOwnedZones: operatingModel.human_owned_zones,
            taxonomy: {
              labelGroups: {
                type: operatingModel.taxonomy.label_groups.type,
                risk: operatingModel.taxonomy.label_groups.risk,
                source: operatingModel.taxonomy.label_groups.source,
                mode: operatingModel.taxonomy.label_groups.mode,
                human: operatingModel.taxonomy.label_groups.human,
              },
              reasonCodeGroups: {
                needs: operatingModel.taxonomy.reason_code_groups.needs,
                blocked: operatingModel.taxonomy.reason_code_groups.blocked,
                rework: operatingModel.taxonomy.reason_code_groups.rework,
              },
            },
          },
    linearStateMappings: linearStateMappingRows.map((row) => ({
      statusCode: row.status_code,
      linearStateName: row.linear_state_name,
      syncEnabled: row.sync_enabled,
    })),
    linearMilestonePolicies: linearMilestonePolicyRows.map((row) => ({
      eventCode: row.event_code,
      eventLabel: row.event_label,
      postComment: row.post_comment,
      createProjectUpdate: row.create_project_update,
      projectUpdateHealth: row.project_update_health,
    })),
  }
}

export function validateWorkflowManifestBundle(
  bundle: WorkflowManifestBundle,
): WorkflowManifestValidationResult {
  const issues: string[] = []
  const operatingModel = bundle.operatingModel

  if (!operatingModel) {
    throw new WorkflowManifestValidationError([
      'operating_model.yaml must be loaded before validation',
    ])
  }

  ensureUnique(
    bundle.statuses.map((status) => status.code),
    'status code',
    issues,
  )
  ensureUnique(
    bundle.triggers.map((trigger) => trigger.code),
    'trigger code',
    issues,
  )
  ensureUnique(
    bundle.transitionRules.map((rule) => rule.ruleId),
    'transition rule id',
    issues,
  )
  ensureUnique(
    bundle.reasonCodes.map((reasonCode) => reasonCode.code),
    'reason code',
    issues,
  )
  ensureUnique(
    bundle.roleExecutionPolicies.map((policy) => policy.ownerRole),
    'role execution policy',
    issues,
  )
  ensureUnique(
    bundle.runtimeRoleContracts.map((contract) => contract.roleId),
    'runtime role contract',
    issues,
  )
  ensureUnique(
    bundle.linearStateMappings.map((mapping) => mapping.statusCode),
    'linear state mapping',
    issues,
  )
  ensureUnique(
    bundle.linearMilestonePolicies.map((policy) => policy.eventCode),
    'linear milestone policy',
    issues,
  )
  ensureUnique(
    operatingModel.roles.map((role) => role.roleId),
    'canonical operating-model role',
    issues,
  )
  ensureUnique(
    operatingModel.humanOwnedZones,
    'human-owned zone',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.labelGroups.type,
    'type label taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.labelGroups.risk,
    'risk label taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.labelGroups.source,
    'source label taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.labelGroups.mode,
    'mode label taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.labelGroups.human,
    'human label taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.reasonCodeGroups.needs,
    'needs reason taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.reasonCodeGroups.blocked,
    'blocked reason taxonomy value',
    issues,
  )
  ensureUnique(
    operatingModel.taxonomy.reasonCodeGroups.rework,
    'rework reason taxonomy value',
    issues,
  )
  ensureUnique(
    bundle.statusEntryHooks.map(
      (hook) => `${hook.statusCode}:${hook.hookOrder.toString()}`,
    ),
    'status entry hook ordering',
    issues,
  )

  const statusCodes = new Set(bundle.statuses.map((status) => status.code))
  const triggerMap = new Map(bundle.triggers.map((trigger) => [trigger.code, trigger]))
  const ruleIds = new Set(bundle.transitionRules.map((rule) => rule.ruleId))
  const reasonCodeIds = new Set(bundle.reasonCodes.map((reasonCode) => reasonCode.code))
  const canonicalRoles = new Set(operatingModel.roles.map((role) => role.roleId))
  const runtimePlaceholderRoles = new Set(['build_agent'])
  const ownerRoles = new Set(
    bundle.transitionRules
      .map((rule) => rule.ownerRole)
      .filter((ownerRole) => ownerRole !== 'human'),
  )
  const hookOwnerRoles = new Set(
    bundle.statusEntryHooks
      .flatMap((hook) => [hook.ownerRole, hook.targetOwnerRole])
      .filter((ownerRole): ownerRole is string => ownerRole !== null && ownerRole !== 'human'),
  )
  const rolePolicyOwnerRoles = new Set(
    bundle.roleExecutionPolicies.map((policy) => policy.ownerRole),
  )
  const runtimeRoleContractsById = new Map(
    bundle.runtimeRoleContracts.map((contract) => [contract.roleId, contract]),
  )
  const runtimeRoleIds = new Set(runtimeRoleContractsById.keys())
  const allowedReasonCategories = new Set([
    ...Object.keys(operatingModel.taxonomy.reasonCodeGroups),
    'cancel',
    'duplicate',
  ])
  const visibleLinearRoles = operatingModel.roles.filter(
    (role) => role.visibleInLinear,
  )

  if (!canonicalRoles.has('orchestrator')) {
    issues.push('operating_model.yaml: missing canonical role orchestrator')
  }

  if (!canonicalRoles.has('integration_agent')) {
    issues.push('operating_model.yaml: missing canonical role integration_agent')
  }

  if (!canonicalRoles.has('build_agent_integrations')) {
    issues.push(
      'operating_model.yaml: missing canonical role build_agent_integrations',
    )
  }

  if (visibleLinearRoles.length !== 1) {
    issues.push(
      `operating_model.yaml: expected exactly one visible Linear actor, found ${visibleLinearRoles.length.toString()}`,
    )
  }

  const primaryLinearActorRole =
    operatingModel.visibleLinearSurface.primaryActorRole
  if (!canonicalRoles.has(primaryLinearActorRole)) {
    issues.push(
      `operating_model.yaml: unknown primary_actor_role ${primaryLinearActorRole}`,
    )
  }

  if (primaryLinearActorRole !== 'orchestrator') {
    issues.push(
      'operating_model.yaml: primary_actor_role must remain orchestrator',
    )
  }

  if (
    visibleLinearRoles.length === 1 &&
    visibleLinearRoles[0]?.roleId !== primaryLinearActorRole
  ) {
    issues.push(
      'operating_model.yaml: visible_in_linear role must match primary_actor_role',
    )
  }

  for (const futureActor of operatingModel.visibleLinearSurface.optionalFutureLinearActors) {
    if (!canonicalRoles.has(futureActor)) {
      issues.push(
        `operating_model.yaml: unknown optional future Linear actor ${futureActor}`,
      )
    }
    if (futureActor === primaryLinearActorRole) {
      issues.push(
        'operating_model.yaml: primary_actor_role cannot also be optional future actor',
      )
    }
  }

  for (const rule of bundle.transitionRules) {
    if (!statusCodes.has(rule.fromStatus)) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: unknown from_status ${rule.fromStatus}`,
      )
    }

    if (!statusCodes.has(rule.toStatus)) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: unknown to_status ${rule.toStatus}`,
      )
    }

    const trigger = triggerMap.get(rule.triggerCode)
    if (!trigger) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: unknown trigger_code ${rule.triggerCode}`,
      )
    } else if (!rule.allowedActorTypes.includes(trigger.actorType)) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: allowed_actor_types must include trigger actor_type ${trigger.actorType}`,
      )
    }

    if (
      rule.ownerRole !== 'human' &&
      !canonicalRoles.has(rule.ownerRole) &&
      !runtimePlaceholderRoles.has(rule.ownerRole)
    ) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: owner_role ${rule.ownerRole} is missing from operating_model.yaml`,
      )
    }

    const ownerContract = runtimeRoleContractsById.get(rule.ownerRole)
    if (rule.ownerRole !== 'human' && !ownerContract) {
      issues.push(
        `runtime_role_contracts.yaml: missing contract for transition owner_role ${rule.ownerRole}`,
      )
    } else if (
      ownerContract &&
      !ownerContract.allowedStatusOwnership.includes(rule.fromStatus)
    ) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: owner_role ${rule.ownerRole} does not allow source status ${rule.fromStatus}`,
      )
    }

    if (
      rule.requiresReasonCode &&
      !bundle.reasonCodes.some((reasonCode) =>
        reasonCode.allowedOnTransitions.includes(rule.ruleId),
      )
    ) {
      issues.push(
        `transition_rules.yaml ${rule.ruleId}: requires_reason_code=true but no reason code references this rule`,
      )
    }
  }

  for (const hook of bundle.statusEntryHooks) {
    if (!statusCodes.has(hook.statusCode)) {
      issues.push(
        `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: unknown status_code`,
      )
    }

    if (
      !canonicalRoles.has(hook.ownerRole) &&
      !runtimePlaceholderRoles.has(hook.ownerRole)
    ) {
      issues.push(
        `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: owner_role ${hook.ownerRole} is missing from operating_model.yaml`,
      )
    }

    const hookOwnerContract = runtimeRoleContractsById.get(hook.ownerRole)
    if (!hookOwnerContract) {
      issues.push(
        `runtime_role_contracts.yaml: missing contract for status entry hook owner_role ${hook.ownerRole}`,
      )
    } else if (!hookOwnerContract.allowedStatusOwnership.includes(hook.statusCode)) {
      issues.push(
        `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: owner_role ${hook.ownerRole} does not allow status ${hook.statusCode}`,
      )
    }

    if (hook.targetOwnerRole) {
      if (
        !canonicalRoles.has(hook.targetOwnerRole) &&
        !runtimePlaceholderRoles.has(hook.targetOwnerRole)
      ) {
        issues.push(
          `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: target_owner_role ${hook.targetOwnerRole} is missing from operating_model.yaml`,
        )
      }

      if (!runtimeRoleIds.has(hook.targetOwnerRole)) {
        issues.push(
          `runtime_role_contracts.yaml: missing contract for status entry hook target_owner_role ${hook.targetOwnerRole}`,
        )
      }
    }

    if (
      hook.emitsCommandType === 'create_runner_lease' &&
      !rolePolicyOwnerRoles.has(hook.ownerRole)
    ) {
      issues.push(
        `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: lease-producing owner_role ${hook.ownerRole} is missing a role execution policy`,
      )
    }

    if (
      hook.emitsCommandType === 'release_runner_lease' &&
      hook.targetOwnerRole &&
      !rolePolicyOwnerRoles.has(hook.targetOwnerRole)
    ) {
      issues.push(
        `status_entry_hooks.yaml ${hook.statusCode}:${hook.hookOrder.toString()}: target_owner_role ${hook.targetOwnerRole} is missing a role execution policy`,
      )
    }
  }

  for (const mapping of bundle.linearStateMappings) {
    if (!statusCodes.has(mapping.statusCode)) {
      issues.push(
        `linear_sync.yaml statuses.${mapping.statusCode}: unknown status_code`,
      )
    }
  }

  for (const statusCode of statusCodes) {
    if (!bundle.linearStateMappings.some((mapping) => mapping.statusCode === statusCode)) {
      issues.push(`linear_sync.yaml statuses: missing mapping for ${statusCode}`)
    }
  }

  for (const policy of bundle.linearMilestonePolicies) {
    if (!policy.postComment && !policy.createProjectUpdate) {
      issues.push(
        `linear_sync.yaml milestones.${policy.eventCode}: at least one action must be enabled`,
      )
    }

    if (!policy.createProjectUpdate && policy.projectUpdateHealth !== null) {
      issues.push(
        `linear_sync.yaml milestones.${policy.eventCode}: project_update_health requires create_project_update=true`,
      )
    }
  }

  for (const reasonCode of bundle.reasonCodes) {
    if (!allowedReasonCategories.has(reasonCode.category)) {
      issues.push(
        `reason_codes.yaml ${reasonCode.code}: unknown category ${reasonCode.category}`,
      )
    }

    for (const transitionId of reasonCode.allowedOnTransitions) {
      if (!ruleIds.has(transitionId)) {
        issues.push(
          `reason_codes.yaml ${reasonCode.code}: unknown transition rule ${transitionId}`,
        )
      }
    }
  }

  for (const ownerRole of ownerRoles) {
    if (!canonicalRoles.has(ownerRole) && !runtimePlaceholderRoles.has(ownerRole)) {
      issues.push(
        `transition_rules.yaml: owner_role ${ownerRole} is missing from operating_model.yaml`,
      )
    }

    if (!rolePolicyOwnerRoles.has(ownerRole)) {
      issues.push(
        `role_execution_policies.yaml: missing policy for owner_role ${ownerRole}`,
      )
    }
  }

  for (const ownerRole of hookOwnerRoles) {
    if (!runtimeRoleIds.has(ownerRole)) {
      issues.push(
        `runtime_role_contracts.yaml: missing contract for hook owner_role ${ownerRole}`,
      )
    }
  }

  for (const contract of bundle.runtimeRoleContracts) {
    const isCanonicalRole = canonicalRoles.has(contract.roleId)
    const isCompatibilityOnly = contract.activationMode === 'compatibility_only'

    if (!isCanonicalRole && !isCompatibilityOnly) {
      issues.push(
        `runtime_role_contracts.yaml ${contract.roleId}: role_id is missing from operating_model.yaml`,
      )
    }

    if (isCompatibilityOnly && isCanonicalRole) {
      issues.push(
        `runtime_role_contracts.yaml ${contract.roleId}: compatibility-only roles cannot exist in operating_model.yaml`,
      )
    }

    if (
      isCompatibilityOnly &&
      (operatingModel.visibleLinearSurface.primaryActorRole === contract.roleId ||
        operatingModel.visibleLinearSurface.optionalFutureLinearActors.includes(
          contract.roleId,
        ))
    ) {
      issues.push(
        `runtime_role_contracts.yaml ${contract.roleId}: compatibility-only roles cannot be visible actors or canonical rollout roles`,
      )
    }

    if (
      (contract.roleId === 'build_agent' || contract.roleId.startsWith('build_agent_')) &&
      contract.canonicalRunKind !== 'build'
    ) {
      issues.push(
        `runtime_role_contracts.yaml ${contract.roleId}: build-profile roles must declare canonical_run_kind = build`,
      )
    }

    if (
      contract.humanGatePolicy.mode === 'none' &&
      contract.humanGatePolicy.requiredHumanOwnedZones.length > 0
    ) {
      issues.push(
        `runtime_role_contracts.yaml ${contract.roleId}: human_gate_policy.mode=none cannot declare required_human_owned_zones`,
      )
    }

    for (const statusCode of contract.allowedStatusOwnership) {
      if (!statusCodes.has(statusCode)) {
        issues.push(
          `runtime_role_contracts.yaml ${contract.roleId}: unknown allowed_status_ownership ${statusCode}`,
        )
      }
    }

    for (const zone of contract.humanGatePolicy.requiredHumanOwnedZones) {
      if (!operatingModel.humanOwnedZones.includes(zone)) {
        issues.push(
          `runtime_role_contracts.yaml ${contract.roleId}: unknown human-owned zone ${zone}`,
        )
      }
    }

    for (const reasonCode of contract.escalationReasonCodes) {
      if (!reasonCodeIds.has(reasonCode)) {
        issues.push(
          `runtime_role_contracts.yaml ${contract.roleId}: unknown escalation_reason_code ${reasonCode}`,
        )
      }
    }
  }

  for (const policy of bundle.roleExecutionPolicies) {
    if (
      !canonicalRoles.has(policy.ownerRole) &&
      !runtimePlaceholderRoles.has(policy.ownerRole)
    ) {
      issues.push(
        `role_execution_policies.yaml ${policy.ownerRole}: owner_role is missing from operating_model.yaml`,
      )
    }

    if (policy.primaryProvider === policy.secondaryProvider) {
      issues.push(
        `role_execution_policies.yaml ${policy.ownerRole}: primary_provider and secondary_provider must differ`,
      )
    }

    if (!runtimeRoleIds.has(policy.ownerRole)) {
      issues.push(
        `runtime_role_contracts.yaml: missing contract for role_execution_policy owner_role ${policy.ownerRole}`,
      )
    }
  }

  if (!statusCodes.has('blocked')) {
    issues.push('status_catalog.yaml: missing canonical status blocked')
  }

  if (!statusCodes.has('needs_human_decision')) {
    issues.push(
      'status_catalog.yaml: missing canonical status needs_human_decision',
    )
  }

  if (issues.length > 0) {
    throw new WorkflowManifestValidationError(issues)
  }

  return {
    bundle,
    summary: {
      statusCount: bundle.statuses.length,
      triggerCount: bundle.triggers.length,
      transitionRuleCount: bundle.transitionRules.length,
      hookCount: bundle.statusEntryHooks.length,
      reasonCodeCount: bundle.reasonCodes.length,
      roleExecutionPolicyCount: bundle.roleExecutionPolicies.length,
      runtimeRoleContractCount: bundle.runtimeRoleContracts.length,
      linearStateMappingCount: bundle.linearStateMappings.length,
      linearMilestonePolicyCount: bundle.linearMilestonePolicies.length,
      canonicalRoleCount: operatingModel.roles.length,
      visibleLinearActorCount: visibleLinearRoles.length,
    },
  }
}

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortObject)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableSortObject(entryValue)]),
    )
  }

  return value
}

export function workflowManifestFingerprint(
  bundle: WorkflowManifestBundle,
): string {
  const normalized = {
    configSet: bundle.configSet,
    statuses: [...bundle.statuses].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
    triggers: [...bundle.triggers].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
    transitionRules: [...bundle.transitionRules].sort((left, right) =>
      left.ruleId.localeCompare(right.ruleId),
    ),
    statusEntryHooks: [...bundle.statusEntryHooks].sort((left, right) =>
      `${left.statusCode}:${left.hookOrder.toString()}`.localeCompare(
        `${right.statusCode}:${right.hookOrder.toString()}`,
      ),
    ),
    reasonCodes: [...bundle.reasonCodes].sort((left, right) =>
      left.code.localeCompare(right.code),
    ),
    roleExecutionPolicies: [...bundle.roleExecutionPolicies].sort((left, right) =>
      left.ownerRole.localeCompare(right.ownerRole),
    ),
    runtimeRoleContracts: [...bundle.runtimeRoleContracts].sort((left, right) =>
      left.roleId.localeCompare(right.roleId),
    ),
  }

  return createHash('sha256')
    .update(JSON.stringify(stableSortObject(normalized)))
    .digest('hex')
}
