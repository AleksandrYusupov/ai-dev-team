import { sql } from 'kysely'

import { loadDatabaseConfig } from '@ai-dev-team/config'

import { createDb, migrateToLatest } from '../index.js'
import { publishAgentRuntimeRelease } from '../agent-config/publish.js'

export async function prepareTestDatabase(
  options: {
    publishAgentRuntimeRelease?: boolean
  } = {},
) {
  const config = loadDatabaseConfig(process.env)
  await migrateToLatest(config)

  const db = createDb(config)

  await sql.raw(`
    truncate table
      integration_validation_runs,
      webhook_registrations,
      token_handles,
      oauth_consent_sessions,
      oauth_client_registrations,
      credential_slots,
      runner_artifact_blobs,
      runner_lease_attempts,
      runner_leases,
      agent_routing_skill_pack_rules,
      agent_prompt_bundles,
      agent_skill_packs,
      agent_prompt_families,
      agent_role_charters,
      agent_library_releases,
      runner_capabilities,
      runner_nodes,
      context_pack_cache,
      knowledge_note_snapshots,
      issue_linear_sync_projection,
      linear_issue_contract_snapshots,
      project_repository_mappings,
      repository_registry,
      comment_log,
      lifecycle_command_inbox,
      raw_event_inbox,
      blocked_issues_projection,
      status_projection,
      agent_metrics_daily,
      workflow_effect_outbox,
      artifact_registry,
      issue_runtime_state,
      status_transition_audit,
      issue_runs,
      workflow_runtime_role_contracts,
      workflow_role_execution_policies,
      workflow_reason_codes,
      workflow_status_entry_hooks,
      workflow_transition_rules,
      workflow_trigger_catalog,
      workflow_status_catalog,
      workflow_linear_milestone_policies,
      workflow_linear_state_mappings,
      workflow_config_sets
    restart identity cascade
  `).execute(db)

  await sql.raw(`refresh materialized view mv_status_dwell_times`).execute(db)

  if (options.publishAgentRuntimeRelease !== false) {
    await publishAgentRuntimeRelease(db, {
      publishedBy: 'prepare-test-database',
      activateForNewRuns: true,
    })
  }

  return db
}
