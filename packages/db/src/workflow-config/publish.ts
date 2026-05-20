import { sql, type Kysely } from 'kysely'

import type { ActorType, WorkflowConfigSetStatus, WorkflowConfigSummary } from '@ai-dev-team/shared'

import type { Database } from '../schema.js'

import {
  validateWorkflowManifestBundle,
  workflowManifestFingerprint,
} from './manifest-loader.js'
import type {
  PublishWorkflowConfigInput,
  PublishWorkflowConfigResult,
  WorkflowManifestBundle,
} from './types.js'

const WORKFLOW_CONFIG_PUBLISH_LOCK_ID = 820_335_500_001n
const SERIALIZATION_FAILURE_SQLSTATE = '40001'
const SERIALIZATION_FAILURE_MAX_RETRIES = 3
const SERIALIZATION_RETRY_BASE_DELAY_MS = 25
const SERIALIZATION_RETRY_MAX_DELAY_MS = 250

interface SerializationRetryOptions {
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
}

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSerializationRetryDelayMs(retryCount: number): number {
  return Math.min(
    SERIALIZATION_RETRY_MAX_DELAY_MS,
    SERIALIZATION_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1),
  )
}

export function isSerializationFailureError(error: unknown): boolean {
  let current: unknown = error

  while (isObjectLike(current)) {
    if (current.code === SERIALIZATION_FAILURE_SQLSTATE) {
      return true
    }

    current = current.cause
  }

  return false
}

export async function executeWithSerializationRetry<T>(
  operation: () => Promise<T>,
  options: SerializationRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? SERIALIZATION_FAILURE_MAX_RETRIES
  const wait = options.sleep ?? sleep

  for (let retryCount = 0; ; retryCount += 1) {
    try {
      return await operation()
    } catch (error) {
      if (
        !isSerializationFailureError(error) ||
        retryCount >= maxRetries
      ) {
        throw error
      }

      await wait(getSerializationRetryDelayMs(retryCount + 1))
    }
  }
}

function mapWorkflowConfigSummary(row: {
  config_version: number
  status: string
  is_active_for_new_runs: boolean
  published_by: string | null
  published_at: Date | null
  notes: string | null
  created_at: Date
}): WorkflowConfigSummary {
  return {
    configVersion: row.config_version,
    status: row.status as WorkflowConfigSummary['status'],
    isActiveForNewRuns: row.is_active_for_new_runs,
    publishedBy: row.published_by,
    publishedAt: row.published_at?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  }
}

async function loadPublishedWorkflowManifestBundle(
  db: Kysely<Database>,
  configVersion: number,
): Promise<WorkflowManifestBundle | null> {
  const configSet = await db
    .selectFrom('workflow_config_sets')
    .selectAll()
    .where('config_version', '=', configVersion)
    .executeTakeFirst()

  if (!configSet) {
    return null
  }

  const [
    statuses,
    triggers,
    transitionRules,
    statusEntryHooks,
    reasonCodes,
    roleExecutionPolicies,
    runtimeRoleContracts,
    linearStateMappings,
    linearMilestonePolicies,
  ] = await Promise.all([
      db
        .selectFrom('workflow_status_catalog')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_trigger_catalog')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_transition_rules')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_status_entry_hooks')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_reason_codes')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_role_execution_policies')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_runtime_role_contracts')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_linear_state_mappings')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
      db
        .selectFrom('workflow_linear_milestone_policies')
        .selectAll()
        .where('config_version', '=', configVersion)
        .execute(),
    ])

  return {
    configSet: {
      configVersion: configSet.config_version,
      status: configSet.status as WorkflowConfigSetStatus,
      isActiveForNewRuns: configSet.is_active_for_new_runs,
      notes: configSet.notes,
    },
    statuses: statuses.map((row) => ({
      code: row.code,
      label: row.label,
      group: row.group_code,
      kind: row.kind,
      isTerminal: row.is_terminal,
      manualEntryAllowed: row.manual_entry_allowed,
      manualExitAllowed: row.manual_exit_allowed,
      requiresHuman: row.requires_human,
      blocksExecution: row.blocks_execution,
      sortOrder: row.sort_order,
      description: row.description,
    })),
    triggers: triggers.map((row) => ({
      code: row.code,
      actorType: row.actor_type as WorkflowManifestBundle['triggers'][number]['actorType'],
      isManual: row.is_manual,
      requiresComment: row.requires_comment,
      requiresArtifact: row.requires_artifact,
      description: row.description,
    })),
    transitionRules: transitionRules.map((row) => ({
      ruleId: row.rule_id,
      fromStatus: row.from_status_code,
      toStatus: row.to_status_code,
      triggerCode: row.trigger_code,
      ownerRole: row.owner_role,
      allowedActorTypes: row.allowed_actor_types as ActorType[],
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
    statusEntryHooks: statusEntryHooks.map((row) => ({
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
    reasonCodes: reasonCodes.map((row) => ({
      code: row.code,
      category: row.category,
      description: row.description,
      allowedOnTransitions: row.allowed_on_transitions,
    })),
    roleExecutionPolicies: roleExecutionPolicies.map((row) => ({
      ownerRole: row.owner_role,
      primaryProvider: row.primary_provider,
      secondaryProvider: row.secondary_provider,
      fallbackTriggers: row.fallback_triggers,
      maxProviderFailovers: row.max_provider_failovers,
      mcpProfileRef: row.mcp_profile_ref,
      requiredCapabilities: row.required_capabilities,
    })),
    runtimeRoleContracts: runtimeRoleContracts.map((row) => ({
      roleId: row.role_id,
      canonicalRunKind: row.canonical_run_kind,
      allowedStatusOwnership: row.allowed_status_ownership,
      requiredInputArtifactTypes: row.required_input_artifact_types,
      requiredOutputArtifactTypes: row.required_output_artifact_types,
      humanGatePolicy: row.human_gate_policy,
      escalationReasonCodes: row.escalation_reason_codes,
      activationMode: row.activation_mode,
    })),
    linearStateMappings: linearStateMappings.map((row) => ({
      statusCode: row.status_code,
      linearStateName: row.linear_state_name,
      syncEnabled: row.sync_enabled,
    })),
    linearMilestonePolicies: linearMilestonePolicies.map((row) => ({
      eventCode: row.event_code,
      eventLabel: row.event_label,
      postComment: row.post_comment,
      createProjectUpdate: row.create_project_update,
      projectUpdateHealth: row.project_update_health,
    })),
  }
}

export async function getActiveWorkflowConfigSummary(
  db: Kysely<Database>,
): Promise<WorkflowConfigSummary | null> {
  const row = await db
    .selectFrom('workflow_config_sets')
    .selectAll()
    .where('is_active_for_new_runs', '=', true)
    .executeTakeFirst()

  return row ? mapWorkflowConfigSummary(row) : null
}

export async function publishWorkflowConfig(
  db: Kysely<Database>,
  bundle: WorkflowManifestBundle,
  input: PublishWorkflowConfigInput,
): Promise<PublishWorkflowConfigResult> {
  const { bundle: validatedBundle } = validateWorkflowManifestBundle(bundle)
  const fingerprint = workflowManifestFingerprint(validatedBundle)

  return executeWithSerializationRetry(() =>
    db.transaction().execute(async (trx) => {
      await sql`set transaction isolation level serializable`.execute(trx)
      await sql`select pg_advisory_xact_lock(${WORKFLOW_CONFIG_PUBLISH_LOCK_ID})`.execute(
        trx,
      )

      const existingBundle = await loadPublishedWorkflowManifestBundle(
        trx,
        validatedBundle.configSet.configVersion,
      )

      if (existingBundle) {
        const existingFingerprint = workflowManifestFingerprint(existingBundle)
        if (existingFingerprint !== fingerprint) {
          throw new Error(
            `Config version ${validatedBundle.configSet.configVersion.toString()} already exists with different content`,
          )
        }

        return {
          configVersion: validatedBundle.configSet.configVersion,
          inserted: false,
          isActiveForNewRuns: validatedBundle.configSet.isActiveForNewRuns,
          fingerprint,
        }
      }

      if (validatedBundle.configSet.isActiveForNewRuns) {
        await trx
          .updateTable('workflow_config_sets')
          .set({ is_active_for_new_runs: false })
          .where('is_active_for_new_runs', '=', true)
          .execute()
      }

      await trx
        .insertInto('workflow_config_sets')
        .values({
          config_version: validatedBundle.configSet.configVersion,
          status: validatedBundle.configSet.status,
          is_active_for_new_runs: validatedBundle.configSet.isActiveForNewRuns,
          published_by: input.publishedBy,
          published_at:
            validatedBundle.configSet.status === 'published' ? new Date() : null,
          notes: validatedBundle.configSet.notes,
        })
        .execute()

      await trx
        .insertInto('workflow_status_catalog')
        .values(
          validatedBundle.statuses.map((status) => ({
            code: status.code,
            label: status.label,
            group_code: status.group,
            kind: status.kind,
            is_terminal: status.isTerminal,
            manual_entry_allowed: status.manualEntryAllowed,
            manual_exit_allowed: status.manualExitAllowed,
            requires_human: status.requiresHuman,
            blocks_execution: status.blocksExecution,
            sort_order: status.sortOrder,
            description: status.description,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_trigger_catalog')
        .values(
          validatedBundle.triggers.map((trigger) => ({
            code: trigger.code,
            actor_type: trigger.actorType,
            is_manual: trigger.isManual,
            requires_comment: trigger.requiresComment,
            requires_artifact: trigger.requiresArtifact,
            description: trigger.description,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_transition_rules')
        .values(
          validatedBundle.transitionRules.map((rule) => ({
            rule_id: rule.ruleId,
            from_status_code: rule.fromStatus,
            to_status_code: rule.toStatus,
            trigger_code: rule.triggerCode,
            owner_role: rule.ownerRole,
            allowed_actor_types: toJsonb(rule.allowedActorTypes),
            guard_conditions: toJsonb(rule.guardConditions),
            required_artifact_types: toJsonb(rule.requiredArtifactTypes),
            artifact_scope: rule.artifactScope,
            requires_reason_code: rule.requiresReasonCode,
            requires_checkpoint: rule.requiresCheckpoint,
            requires_active_run: rule.requiresActiveRun,
            requires_human_approval: rule.requiresHumanApproval,
            effect_on_run: rule.effectOnRun,
            opened_run_kind: rule.openedRunKind,
            effect_on_lease: rule.effectOnLease,
            notes: rule.notes,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_status_entry_hooks')
        .values(
          validatedBundle.statusEntryHooks.map((hook) => ({
            status_code: hook.statusCode,
            hook_order: hook.hookOrder,
            hook_type: hook.hookType,
            hook_name: hook.hookName,
            owner_role: hook.ownerRole,
            target_owner_role: hook.targetOwnerRole,
            is_required: hook.isRequired,
            failure_mode: hook.failureMode,
            produces_artifact_type: hook.producesArtifactType,
            emits_command_type: hook.emitsCommandType,
            notes: hook.notes,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_reason_codes')
        .values(
          validatedBundle.reasonCodes.map((reasonCode) => ({
            code: reasonCode.code,
            category: reasonCode.category,
            description: reasonCode.description,
            allowed_on_transitions: toJsonb(reasonCode.allowedOnTransitions),
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_role_execution_policies')
        .values(
          validatedBundle.roleExecutionPolicies.map((policy) => ({
            owner_role: policy.ownerRole,
            primary_provider: policy.primaryProvider,
            secondary_provider: policy.secondaryProvider,
            fallback_triggers: toJsonb(policy.fallbackTriggers),
            max_provider_failovers: policy.maxProviderFailovers,
            mcp_profile_ref: policy.mcpProfileRef,
            required_capabilities: toJsonb(policy.requiredCapabilities),
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_runtime_role_contracts')
        .values(
          validatedBundle.runtimeRoleContracts.map((contract) => ({
            role_id: contract.roleId,
            canonical_run_kind: contract.canonicalRunKind,
            allowed_status_ownership: toJsonb(contract.allowedStatusOwnership),
            required_input_artifact_types: toJsonb(
              contract.requiredInputArtifactTypes,
            ),
            required_output_artifact_types: toJsonb(
              contract.requiredOutputArtifactTypes,
            ),
            human_gate_policy: toJsonb(contract.humanGatePolicy),
            escalation_reason_codes: toJsonb(contract.escalationReasonCodes),
            activation_mode: contract.activationMode,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_linear_state_mappings')
        .values(
          validatedBundle.linearStateMappings.map((mapping) => ({
            status_code: mapping.statusCode,
            linear_state_name: mapping.linearStateName,
            sync_enabled: mapping.syncEnabled,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      await trx
        .insertInto('workflow_linear_milestone_policies')
        .values(
          validatedBundle.linearMilestonePolicies.map((policy) => ({
            event_code: policy.eventCode,
            event_label: policy.eventLabel,
            post_comment: policy.postComment,
            create_project_update: policy.createProjectUpdate,
            project_update_health: policy.projectUpdateHealth,
            config_version: validatedBundle.configSet.configVersion,
          })),
        )
        .execute()

      return {
        configVersion: validatedBundle.configSet.configVersion,
        inserted: true,
        isActiveForNewRuns: validatedBundle.configSet.isActiveForNewRuns,
        fingerprint,
      }
    }),
  )
}
