import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table workflow_transition_rules
      add column opened_run_kind text null
      check (opened_run_kind in ('build', 'review', 'deploy', 'rework_cycle'));

    update workflow_transition_rules
    set opened_run_kind = 'build'
    where rule_id = 'ready_for_build_to_coding_system_build_started';

    create table lifecycle_command_inbox (
      id uuid primary key default gen_random_uuid(),
      command_key text not null unique,
      issue_id text not null,
      workflow_id text not null,
      signal_name text not null
        check (signal_name in ('ingestCanonicalEvent', 'ingestSystemCommand')),
      source text not null,
      source_ref text not null,
      payload jsonb not null,
      status text not null default 'pending'
        check (status in ('pending', 'processing', 'accepted', 'rejected', 'failed', 'dead_letter')),
      attempt_count int not null default 0,
      scheduled_at timestamptz not null default now(),
      accepted_at timestamptz null,
      rejected_at timestamptz null,
      processed_at timestamptz null,
      last_error text null,
      transition_audit_id uuid null references status_transition_audit(id),
      rejection_payload jsonb null,
      created_at timestamptz not null default now()
    );

    create index lifecycle_command_inbox_status_idx
      on lifecycle_command_inbox (status, scheduled_at);
    create index lifecycle_command_inbox_issue_idx
      on lifecycle_command_inbox (issue_id, created_at desc);
    create index lifecycle_command_inbox_workflow_idx
      on lifecycle_command_inbox (workflow_id, created_at desc);

    create materialized view mv_status_dwell_times as
    with ordered as (
      select
        issue_id,
        to_status_code as status_code,
        created_at as entered_at,
        lead(created_at) over (
          partition by issue_id
          order by created_at asc
        ) as exited_at
      from status_transition_audit
    )
    select
      issue_id,
      status_code,
      entered_at,
      exited_at,
      case
        when exited_at is null then null
        else greatest(0, extract(epoch from exited_at - entered_at))::int
      end as dwell_seconds
    from ordered;

    create index mv_status_dwell_times_issue_idx
      on mv_status_dwell_times (issue_id, entered_at desc);
    create index mv_status_dwell_times_status_idx
      on mv_status_dwell_times (status_code, entered_at desc);

    create table agent_metrics_daily (
      metric_date date primary key,
      transition_count int not null default 0,
      lifecycle_command_accepted_count int not null default 0,
      lifecycle_command_rejected_count int not null default 0,
      duplicate_suppression_count int not null default 0,
      run_open_counts jsonb not null default '{}'::jsonb,
      run_close_counts jsonb not null default '{}'::jsonb,
      dwell_p50_seconds jsonb not null default '{}'::jsonb,
      dwell_p90_seconds jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists agent_metrics_daily;
    drop materialized view if exists mv_status_dwell_times;
    drop table if exists lifecycle_command_inbox;
    alter table workflow_transition_rules
      drop column if exists opened_run_kind;
  `).execute(db)
}
