import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table workflow_status_entry_hooks
      add column if not exists owner_role text null,
      add column if not exists target_owner_role text null;

    update workflow_status_entry_hooks
    set owner_role = case
      when status_code = 'triage' then 'intake_agent'
      when status_code = 'needs_spec' then 'spec_agent'
      when status_code = 'needs_input' then 'reporter_agent'
      when status_code = 'planned' then 'plan_agent'
      when status_code = 'ready_for_build' then 'orchestrator'
      when status_code = 'coding' then 'build_agent'
      when status_code = 'agent_review' then 'review_agent'
      when status_code = 'blocked' then 'orchestrator'
      when status_code = 'needs_human_decision' then 'reporter_agent'
      when status_code = 'ready_to_merge' then 'release_agent'
      when status_code = 'deploying' then 'release_agent'
      when status_code = 'monitoring' then 'monitoring_agent'
      when status_code = 'done' then 'reporter_agent'
      else 'orchestrator'
    end
    where owner_role is null;

    alter table workflow_status_entry_hooks
      alter column owner_role set not null;

    alter table issue_runtime_state
      add column if not exists suspended_from_status_code text null;
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table issue_runtime_state
      drop column if exists suspended_from_status_code;

    alter table workflow_status_entry_hooks
      drop column if exists target_owner_role,
      drop column if exists owner_role;
  `).execute(db)
}
