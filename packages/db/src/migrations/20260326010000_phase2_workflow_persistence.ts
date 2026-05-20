import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create extension if not exists pgcrypto;

    create table workflow_config_sets (
      config_version int primary key,
      status text not null check (status in ('draft', 'published', 'deprecated')),
      is_active_for_new_runs boolean not null default false,
      published_by text null,
      published_at timestamptz null,
      notes text null,
      created_at timestamptz not null default now()
    );

    create unique index workflow_config_sets_single_active_idx
      on workflow_config_sets (is_active_for_new_runs)
      where is_active_for_new_runs = true;

    create table workflow_status_catalog (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      label text not null,
      group_code text not null,
      kind text not null,
      is_terminal boolean not null,
      manual_entry_allowed boolean not null,
      manual_exit_allowed boolean not null,
      requires_human boolean not null,
      blocks_execution boolean not null,
      sort_order int not null,
      description text not null,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (code, config_version)
    );

    create table workflow_trigger_catalog (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      actor_type text not null,
      is_manual boolean not null,
      requires_comment boolean not null,
      requires_artifact boolean not null,
      description text not null,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (code, config_version)
    );

    create table workflow_transition_rules (
      id uuid primary key default gen_random_uuid(),
      rule_id text not null,
      from_status_code text not null,
      to_status_code text not null,
      trigger_code text not null,
      owner_role text not null,
      allowed_actor_types jsonb not null default '[]'::jsonb,
      guard_conditions jsonb not null default '[]'::jsonb,
      required_artifact_types jsonb not null default '[]'::jsonb,
      artifact_scope text not null,
      requires_reason_code boolean not null,
      requires_checkpoint boolean not null,
      requires_active_run boolean not null,
      requires_human_approval boolean not null,
      effect_on_run text not null,
      effect_on_lease text not null,
      notes text not null,
      config_version int not null references workflow_config_sets(config_version),
      is_enabled boolean not null default true,
      created_at timestamptz not null default now(),
      unique (rule_id, config_version),
      unique (from_status_code, trigger_code, config_version, rule_id),
      constraint workflow_transition_rules_from_status_fk
        foreign key (from_status_code, config_version)
        references workflow_status_catalog(code, config_version),
      constraint workflow_transition_rules_to_status_fk
        foreign key (to_status_code, config_version)
        references workflow_status_catalog(code, config_version),
      constraint workflow_transition_rules_trigger_fk
        foreign key (trigger_code, config_version)
        references workflow_trigger_catalog(code, config_version)
    );

    create index workflow_transition_rules_lookup_idx
      on workflow_transition_rules (from_status_code, trigger_code, config_version, is_enabled);
    create index workflow_transition_rules_target_idx
      on workflow_transition_rules (to_status_code, config_version);

    create table workflow_status_entry_hooks (
      id uuid primary key default gen_random_uuid(),
      status_code text not null,
      hook_order int not null,
      hook_type text not null,
      hook_name text not null,
      is_required boolean not null,
      failure_mode text not null,
      produces_artifact_type text null,
      emits_command_type text null,
      notes text not null,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (status_code, hook_order, config_version),
      constraint workflow_status_entry_hooks_status_fk
        foreign key (status_code, config_version)
        references workflow_status_catalog(code, config_version)
    );

    create table workflow_reason_codes (
      id uuid primary key default gen_random_uuid(),
      code text not null,
      category text not null,
      description text not null,
      allowed_on_transitions jsonb not null default '[]'::jsonb,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (code, config_version)
    );

    create table issue_runs (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      workflow_id text not null,
      sequence_no int not null,
      run_kind text not null,
      status text not null,
      config_version int not null references workflow_config_sets(config_version),
      opened_by_transition_id uuid not null,
      closed_by_transition_id uuid null,
      branch_ref text null,
      runner_requirements jsonb not null default '{}'::jsonb,
      checkpoint_id uuid null,
      opened_at timestamptz not null default now(),
      closed_at timestamptz null,
      unique (issue_id, sequence_no)
    );

    create index issue_runs_issue_opened_idx on issue_runs (issue_id, opened_at desc);
    create index issue_runs_workflow_opened_idx on issue_runs (workflow_id, opened_at desc);
    create index issue_runs_status_opened_idx on issue_runs (status, opened_at desc);
    create unique index issue_runs_single_open_idx
      on issue_runs (issue_id)
      where status = 'open';

    create table status_transition_audit (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      run_id uuid null references issue_runs(id),
      workflow_id text null,
      config_version int not null references workflow_config_sets(config_version),
      from_status_code text null,
      to_status_code text not null,
      trigger_code text not null,
      rule_id text null,
      actor_type text not null,
      actor_id text not null,
      owner_role text null,
      reason_code text null,
      reason_text text null,
      comment_id text null,
      artifact_links jsonb not null default '[]'::jsonb,
      checkpoint_id uuid null,
      lease_id uuid null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index status_transition_audit_issue_idx
      on status_transition_audit (issue_id, created_at desc);
    create index status_transition_audit_run_idx
      on status_transition_audit (run_id, created_at desc);
    create index status_transition_audit_workflow_idx
      on status_transition_audit (workflow_id, created_at desc);
    create index status_transition_audit_status_idx
      on status_transition_audit (to_status_code, created_at desc);
    create index status_transition_audit_trigger_idx
      on status_transition_audit (trigger_code, created_at desc);

    alter table issue_runs
      add constraint issue_runs_opened_by_transition_fk
      foreign key (opened_by_transition_id)
      references status_transition_audit(id);

    alter table issue_runs
      add constraint issue_runs_closed_by_transition_fk
      foreign key (closed_by_transition_id)
      references status_transition_audit(id);

    create table issue_runtime_state (
      issue_id text primary key,
      current_status_code text not null,
      current_stage text null,
      workflow_id text not null,
      active_run_id uuid null references issue_runs(id),
      pinned_config_version int not null references workflow_config_sets(config_version),
      open_operator_question_id uuid null,
      pause_reason_code text null,
      pause_reason_text text null,
      resume_condition jsonb null,
      block_reason_code text null,
      block_reason_text text null,
      blocked_by_issue_ids jsonb not null default '[]'::jsonb,
      active_lease_id text null,
      updated_at timestamptz not null default now(),
      constraint issue_runtime_state_status_fk
        foreign key (current_status_code, pinned_config_version)
        references workflow_status_catalog(code, config_version),
      constraint issue_runtime_state_pause_fields_chk
        check (
          current_status_code = 'needs_input'
          or (
            pause_reason_code is null
            and pause_reason_text is null
            and resume_condition is null
            and open_operator_question_id is null
          )
        ),
      constraint issue_runtime_state_block_fields_chk
        check (
          current_status_code = 'blocked'
          or (
            block_reason_code is null
            and block_reason_text is null
            and blocked_by_issue_ids = '[]'::jsonb
          )
        )
    );

    create table artifact_registry (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      run_id uuid null references issue_runs(id),
      transition_audit_id uuid null references status_transition_audit(id),
      artifact_type text not null,
      artifact_scope text not null,
      artifact_uri text not null,
      artifact_summary text null,
      produced_by_role text null,
      produced_for_status_code text null,
      superseded_at timestamptz null,
      metadata jsonb not null default '{}'::jsonb,
      produced_at timestamptz not null default now()
    );

    create index artifact_registry_issue_type_idx
      on artifact_registry (issue_id, artifact_type, artifact_scope, produced_at desc);
    create index artifact_registry_run_type_idx
      on artifact_registry (run_id, artifact_type, produced_at desc);
    create index artifact_registry_transition_type_idx
      on artifact_registry (transition_audit_id, artifact_type);
    create unique index artifact_registry_open_operator_question_idx
      on artifact_registry (issue_id)
      where artifact_type = 'operator_question' and superseded_at is null;

    alter table issue_runtime_state
      add constraint issue_runtime_state_open_operator_question_fk
      foreign key (open_operator_question_id)
      references artifact_registry(id);

    create table workflow_effect_outbox (
      id uuid primary key default gen_random_uuid(),
      transition_audit_id uuid not null references status_transition_audit(id),
      issue_id text not null,
      run_id uuid null references issue_runs(id),
      command_type text not null,
      command_payload jsonb not null,
      idempotency_key text not null,
      status text not null default 'pending',
      attempt_count int not null default 0,
      scheduled_at timestamptz not null default now(),
      executed_at timestamptz null,
      last_error text null,
      created_at timestamptz not null default now(),
      unique (idempotency_key)
    );

    create index workflow_effect_outbox_status_idx
      on workflow_effect_outbox (status, scheduled_at);
    create index workflow_effect_outbox_issue_idx
      on workflow_effect_outbox (issue_id, created_at desc);
    create index workflow_effect_outbox_transition_idx
      on workflow_effect_outbox (transition_audit_id);

    create table status_projection (
      issue_id text primary key,
      current_status_code text not null,
      current_owner_role text null,
      is_blocked boolean not null,
      is_waiting_for_input boolean not null,
      needs_human boolean not null,
      active_lease_id text null,
      active_run_id uuid null,
      last_transition_at timestamptz not null,
      last_transition_trigger text not null,
      stuck_for_seconds int not null,
      high_risk boolean not null
    );

    create table blocked_issues_projection (
      issue_id text primary key,
      blocked_by_issue_ids jsonb not null default '[]'::jsonb,
      blocked_by_external boolean not null,
      block_reason_code text null,
      since timestamptz not null
    );
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists blocked_issues_projection;
    drop table if exists status_projection;
    drop table if exists workflow_effect_outbox;
    alter table issue_runtime_state drop constraint if exists issue_runtime_state_open_operator_question_fk;
    drop table if exists artifact_registry;
    drop table if exists issue_runtime_state;
    alter table issue_runs drop constraint if exists issue_runs_closed_by_transition_fk;
    alter table issue_runs drop constraint if exists issue_runs_opened_by_transition_fk;
    drop table if exists status_transition_audit;
    drop table if exists issue_runs;
    drop table if exists workflow_reason_codes;
    drop table if exists workflow_status_entry_hooks;
    drop table if exists workflow_transition_rules;
    drop table if exists workflow_trigger_catalog;
    drop table if exists workflow_status_catalog;
    drop table if exists workflow_config_sets;
  `).execute(db)
}
