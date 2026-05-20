import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table workflow_role_execution_policies (
      id uuid primary key default gen_random_uuid(),
      owner_role text not null,
      primary_provider text not null check (primary_provider in ('codex', 'claude')),
      secondary_provider text not null check (secondary_provider in ('codex', 'claude')),
      fallback_triggers jsonb not null default '[]'::jsonb,
      max_provider_failovers int not null check (max_provider_failovers >= 0),
      mcp_profile_ref text not null,
      required_capabilities jsonb not null default '[]'::jsonb,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (owner_role, config_version)
    );

    create table runner_nodes (
      runner_node_id text primary key,
      display_name text not null,
      host_name text not null,
      host_group_id text not null,
      status text not null check (status in ('online', 'degraded', 'offline', 'draining')),
      auth_subject text not null,
      max_concurrent_leases int not null check (max_concurrent_leases > 0),
      current_active_lease_count int not null default 0 check (current_active_lease_count >= 0),
      last_heartbeat_at timestamptz null,
      heartbeat_expires_at timestamptz null,
      manifest_version int not null default 1 check (manifest_version > 0),
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table runner_capabilities (
      id uuid primary key default gen_random_uuid(),
      runner_node_id text not null references runner_nodes(runner_node_id) on delete cascade,
      manifest_version int not null check (manifest_version > 0),
      providers jsonb not null default '[]'::jsonb,
      provider_cli_versions jsonb not null default '{}'::jsonb,
      supported_roles jsonb not null default '[]'::jsonb,
      supported_run_kinds jsonb not null default '[]'::jsonb,
      supported_repo_kinds jsonb not null default '[]'::jsonb,
      mcp_server_catalog jsonb not null default '[]'::jsonb,
      tool_baseline jsonb not null default '[]'::jsonb,
      workspace_root text not null,
      worktree_root text not null,
      default_shell text not null,
      host_os text not null,
      host_arch text not null,
      supports_interrupt boolean not null default false,
      supports_checkpoint_resume boolean not null default false,
      supports_artifact_upload boolean not null default false,
      supports_concurrent_sessions boolean not null default false,
      is_active boolean not null default true,
      published_at timestamptz not null default now(),
      unique (runner_node_id, manifest_version)
    );

    create unique index runner_capabilities_single_active_idx
      on runner_capabilities (runner_node_id)
      where is_active = true;

    create table runner_leases (
      lease_id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      run_id uuid null references issue_runs(id) on delete set null,
      workflow_id text not null,
      requested_provider text not null check (requested_provider in ('codex', 'claude')),
      requested_owner_role text not null,
      requested_run_kind text null,
      role_execution_policy_version int not null references workflow_config_sets(config_version),
      runner_requirement_profile_json jsonb not null default '{}'::jsonb,
      context_pack_fingerprint text null,
      status text not null check (
        status in (
          'requested',
          'acquired',
          'execution_started',
          'heartbeat_lost',
          'expired',
          'cancellation_requested',
          'completed',
          'failed',
          'released',
          'provider_fallback_exhausted'
        )
      ),
      requested_at timestamptz not null default now(),
      acquired_at timestamptz null,
      execution_started_at timestamptz null,
      last_heartbeat_at timestamptz null,
      heartbeat_expires_at timestamptz null,
      failed_at timestamptz null,
      completed_at timestamptz null,
      released_at timestamptz null,
      cancellation_requested_at timestamptz null,
      released_reason_code text null,
      assigned_runner_node_id text null references runner_nodes(runner_node_id) on delete set null,
      result_artifact_id uuid null references artifact_registry(id) on delete set null,
      attempt_count int not null default 0 check (attempt_count >= 0),
      last_error text null,
      requested_by_command_key text null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create unique index runner_leases_single_active_run_idx
      on runner_leases (run_id)
      where run_id is not null
        and status in (
          'requested',
          'acquired',
          'execution_started',
          'heartbeat_lost',
          'expired',
          'cancellation_requested'
        );

    create index runner_leases_issue_status_idx
      on runner_leases (issue_id, status, requested_at desc);
    create index runner_leases_runner_status_idx
      on runner_leases (assigned_runner_node_id, status, requested_at desc);

    create table runner_lease_attempts (
      lease_attempt_id uuid primary key default gen_random_uuid(),
      lease_id uuid not null references runner_leases(lease_id) on delete cascade,
      provider_attempt_no int not null check (provider_attempt_no > 0),
      requested_provider text not null check (requested_provider in ('codex', 'claude')),
      effective_provider text not null check (effective_provider in ('codex', 'claude')),
      fallback_from_provider text null check (fallback_from_provider in ('codex', 'claude')),
      fallback_reason text null check (
        fallback_reason in (
          'quota_exhausted',
          'rate_limited_exhausted',
          'auth_unavailable',
          'provider_unhealthy',
          'no_eligible_runner'
        )
      ),
      execution_session_key text not null,
      mcp_profile_ref text not null,
      mcp_bindings_summary jsonb not null default '[]'::jsonb,
      runner_node_id text null references runner_nodes(runner_node_id) on delete set null,
      host_group_id text null,
      status text not null check (
        status in (
          'requested',
          'acquired',
          'execution_started',
          'failed',
          'completed',
          'released',
          'abandoned_for_fallback'
        )
      ),
      acquired_at timestamptz null,
      execution_started_at timestamptz null,
      last_heartbeat_at timestamptz null,
      failed_at timestamptz null,
      completed_at timestamptz null,
      released_at timestamptz null,
      error_class text null check (
        error_class in (
          'quota_exhausted',
          'rate_limited_exhausted',
          'auth_unavailable',
          'provider_unhealthy',
          'no_eligible_runner',
          'transport_error',
          'worker_error',
          'artifact_upload_failed',
          'canceled'
        )
      ),
      error_message text null,
      checkpoint_ref text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (lease_id, provider_attempt_no),
      unique (execution_session_key)
    );

    create index runner_lease_attempts_lease_status_idx
      on runner_lease_attempts (lease_id, status, provider_attempt_no desc);
    create index runner_lease_attempts_runner_status_idx
      on runner_lease_attempts (runner_node_id, status, created_at desc);

    create view runner_inventory_view as
      select
        nodes.runner_node_id,
        nodes.host_group_id,
        nodes.display_name,
        nodes.host_name,
        nodes.status,
        coalesce(cap.providers, '[]'::jsonb) as providers,
        nodes.current_active_lease_count,
        nodes.max_concurrent_leases,
        nodes.manifest_version,
        nodes.last_heartbeat_at,
        nodes.heartbeat_expires_at,
        coalesce((
          select count(*)
          from jsonb_array_elements(coalesce(cap.mcp_server_catalog, '[]'::jsonb)) as entry
          where coalesce(entry->>'sharingScope', 'exclusive') <> 'exclusive'
        ), 0)::int as shared_mcp_process_count,
        coalesce(cap.mcp_server_catalog, '[]'::jsonb) as mcp_server_catalog
      from runner_nodes as nodes
      left join lateral (
        select *
        from runner_capabilities as capabilities
        where capabilities.runner_node_id = nodes.runner_node_id
          and capabilities.is_active = true
        order by capabilities.manifest_version desc
        limit 1
      ) as cap on true;

    create view active_runner_leases_view as
      select
        lease_id,
        issue_id,
        run_id,
        workflow_id,
        requested_provider,
        requested_owner_role,
        requested_run_kind,
        role_execution_policy_version,
        status,
        assigned_runner_node_id,
        requested_at,
        acquired_at,
        execution_started_at,
        last_heartbeat_at,
        heartbeat_expires_at,
        failed_at,
        completed_at,
        released_at,
        released_reason_code,
        attempt_count,
        last_error
      from runner_leases
      where status in (
        'requested',
        'acquired',
        'execution_started',
        'heartbeat_lost',
        'expired',
        'cancellation_requested'
      );

    create view stale_runner_leases_view as
      select
        lease_id,
        issue_id,
        run_id,
        workflow_id,
        requested_provider,
        requested_owner_role,
        requested_run_kind,
        role_execution_policy_version,
        status,
        assigned_runner_node_id,
        requested_at,
        acquired_at,
        execution_started_at,
        last_heartbeat_at,
        heartbeat_expires_at,
        failed_at,
        completed_at,
        released_at,
        released_reason_code,
        attempt_count,
        last_error
      from runner_leases
      where status in ('heartbeat_lost', 'expired')
         or (
           heartbeat_expires_at is not null
           and heartbeat_expires_at < now()
           and status in ('acquired', 'execution_started', 'cancellation_requested')
         );

    create view provider_failover_metrics_view as
      with fallback_reason_counts as (
        select coalesce(
          jsonb_object_agg(fallback_reason, reason_count),
          '{}'::jsonb
        ) as fallback_reason_counts
        from (
          select
            fallback_reason,
            count(*)::int as reason_count
          from runner_lease_attempts
          where fallback_reason is not null
          group by fallback_reason
        ) as counts
      ),
      mcp_binding_stats as (
        select
          count(*)::numeric as total_bindings,
          count(*) filter (
            where coalesce((binding->>'reused')::boolean, false)
          )::numeric as reused_bindings
        from runner_lease_attempts
        cross join lateral jsonb_array_elements(
          coalesce(mcp_bindings_summary, '[]'::jsonb)
        ) as binding
      ),
      shared_process_counts as (
        select coalesce(sum(shared_mcp_process_count), 0)::int as shared_mcp_process_count
        from runner_inventory_view
      )
      select
        count(*)::int as total_leases,
        count(*) filter (where attempt_count > 1)::int as fallback_triggered_count,
        count(*) filter (where status = 'provider_fallback_exhausted')::int as provider_fallback_exhausted_count,
        (
          select count(*)::int
          from runner_lease_attempts
          where fallback_reason in ('quota_exhausted', 'rate_limited_exhausted')
        ) as provider_limit_exhaustion_events,
        (select fallback_reason_counts from fallback_reason_counts) as fallback_reason_counts,
        case
          when (select total_bindings from mcp_binding_stats) = 0 then null
          else round(
            (select reused_bindings from mcp_binding_stats)
            / nullif((select total_bindings from mcp_binding_stats), 0),
            4
          )::double precision
        end as mcp_pool_reuse_ratio,
        (select shared_mcp_process_count from shared_process_counts) as shared_mcp_process_count
      from runner_leases;
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop view if exists provider_failover_metrics_view;
    drop view if exists stale_runner_leases_view;
    drop view if exists active_runner_leases_view;
    drop view if exists runner_inventory_view;
    drop table if exists runner_lease_attempts;
    drop table if exists runner_leases;
    drop table if exists runner_capabilities;
    drop table if exists runner_nodes;
    drop table if exists workflow_role_execution_policies;
  `).execute(db)
}
