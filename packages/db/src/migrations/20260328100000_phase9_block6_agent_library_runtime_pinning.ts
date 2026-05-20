import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table agent_library_releases (
      release_id text primary key,
      library_id text not null,
      library_version text not null,
      library_fingerprint text not null,
      published_at timestamptz not null,
      published_by text not null,
      source_library_fingerprint text not null,
      is_active_for_new_runs boolean not null default false,
      created_at timestamptz not null default now()
    );

    create unique index agent_library_releases_single_active_idx
      on agent_library_releases (library_id)
      where is_active_for_new_runs = true;

    create table agent_role_charters (
      id uuid primary key default gen_random_uuid(),
      release_id text not null references agent_library_releases(release_id) on delete cascade,
      role_id text not null,
      charter_version text not null,
      canonical_run_kind text null check (
        canonical_run_kind in ('build', 'review', 'deploy', 'rework_cycle')
      ),
      frontmatter_json jsonb not null,
      source_refs jsonb not null default '[]'::jsonb,
      body text not null,
      relative_path text not null,
      role_fingerprint text not null,
      created_at timestamptz not null default now(),
      unique (release_id, role_id)
    );

    create index agent_role_charters_release_role_idx
      on agent_role_charters (release_id, role_id);

    create table agent_prompt_families (
      id uuid primary key default gen_random_uuid(),
      release_id text not null references agent_library_releases(release_id) on delete cascade,
      prompt_family_ref text not null,
      family_id text not null,
      family_version text not null,
      provider_compatibility jsonb not null default '[]'::jsonb,
      compatible_roles jsonb not null default '[]'::jsonb,
      compatible_skill_packs jsonb not null default '[]'::jsonb,
      source_refs jsonb not null default '[]'::jsonb,
      body text not null,
      relative_path text not null,
      family_fingerprint text not null,
      created_at timestamptz not null default now(),
      unique (release_id, prompt_family_ref)
    );

    create index agent_prompt_families_release_ref_idx
      on agent_prompt_families (release_id, prompt_family_ref);

    create table agent_skill_packs (
      id uuid primary key default gen_random_uuid(),
      release_id text not null references agent_library_releases(release_id) on delete cascade,
      pack_id text not null,
      pack_version text not null,
      purpose text not null,
      skill_refs jsonb not null default '[]'::jsonb,
      optional_skill_refs jsonb not null default '[]'::jsonb,
      providers jsonb not null default '[]'::jsonb,
      activation_conditions jsonb not null default '{}'::jsonb,
      prompt_family_refs jsonb not null default '[]'::jsonb,
      denied_actions_overlay jsonb not null default '[]'::jsonb,
      human_gate_overlay jsonb not null default '{}'::jsonb,
      source_refs jsonb not null default '[]'::jsonb,
      skill_pack_fingerprint text not null,
      created_at timestamptz not null default now(),
      unique (release_id, pack_id)
    );

    create index agent_skill_packs_release_pack_idx
      on agent_skill_packs (release_id, pack_id);

    create table agent_prompt_bundles (
      id uuid primary key default gen_random_uuid(),
      release_id text not null references agent_library_releases(release_id) on delete cascade,
      role_id text not null,
      prompt_bundle_ref text not null,
      role_charter_ref text not null,
      prompt_version text not null,
      prompt_bundle_fingerprint text not null,
      default_skill_pack_refs jsonb not null default '[]'::jsonb,
      default_prompt_family_refs jsonb not null default '[]'::jsonb,
      resolution_mode text not null check (
        resolution_mode in ('canonical', 'compatibility_alias')
      ),
      created_at timestamptz not null default now(),
      unique (release_id, role_id),
      unique (prompt_bundle_ref)
    );

    create index agent_prompt_bundles_release_role_idx
      on agent_prompt_bundles (release_id, role_id);

    create table agent_routing_skill_pack_rules (
      id uuid primary key default gen_random_uuid(),
      release_id text not null references agent_library_releases(release_id) on delete cascade,
      rule_id text not null,
      statuses jsonb not null default '[]'::jsonb,
      triggers jsonb not null default '[]'::jsonb,
      task_types jsonb not null default '[]'::jsonb,
      requires_integration boolean null,
      add_skill_pack_refs jsonb not null default '[]'::jsonb,
      notes text not null,
      created_at timestamptz not null default now(),
      unique (release_id, rule_id)
    );

    create index agent_routing_skill_pack_rules_release_rule_idx
      on agent_routing_skill_pack_rules (release_id, rule_id);

    alter table issue_runs
      add column agent_library_release_id text null references agent_library_releases(release_id) on delete set null,
      add column agent_library_fingerprint text null;

    create index issue_runs_agent_library_release_idx
      on issue_runs (agent_library_release_id, opened_at desc);

    alter table runner_leases
      add column agent_library_release_id text null references agent_library_releases(release_id) on delete set null,
      add column role_charter_ref text null,
      add column prompt_version text null,
      add column task_instructions_ref text null,
      add column prompt_bundle_fingerprint text null,
      add column skill_pack_refs jsonb not null default '[]'::jsonb,
      add column resolved_prompt_family_refs jsonb not null default '[]'::jsonb,
      add column effective_skill_fingerprint text null,
      add column prompt_resolution_source text null check (
        prompt_resolution_source in (
          'published_bundle',
          'compatibility_alias',
          'legacy_synthetic'
        )
      );

    create index runner_leases_agent_library_release_idx
      on runner_leases (agent_library_release_id, requested_at desc);
  `).execute(db)

  await sql.raw(`
    drop view if exists active_runner_leases_view;

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
        agent_library_release_id,
        role_charter_ref,
        prompt_version,
        task_instructions_ref,
        prompt_bundle_fingerprint,
        skill_pack_refs,
        resolved_prompt_family_refs,
        effective_skill_fingerprint,
        prompt_resolution_source,
        context_pack_fingerprint,
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

    drop view if exists stale_runner_leases_view;

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
        agent_library_release_id,
        role_charter_ref,
        prompt_version,
        task_instructions_ref,
        prompt_bundle_fingerprint,
        skill_pack_refs,
        resolved_prompt_family_refs,
        effective_skill_fingerprint,
        prompt_resolution_source,
        context_pack_fingerprint,
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
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop view if exists active_runner_leases_view;
    drop view if exists stale_runner_leases_view;

    drop index if exists runner_leases_agent_library_release_idx;
    alter table runner_leases
      drop column if exists prompt_resolution_source,
      drop column if exists effective_skill_fingerprint,
      drop column if exists resolved_prompt_family_refs,
      drop column if exists skill_pack_refs,
      drop column if exists prompt_bundle_fingerprint,
      drop column if exists task_instructions_ref,
      drop column if exists prompt_version,
      drop column if exists role_charter_ref,
      drop column if exists agent_library_release_id;

    drop index if exists issue_runs_agent_library_release_idx;
    alter table issue_runs
      drop column if exists agent_library_fingerprint,
      drop column if exists agent_library_release_id;

    drop table if exists agent_routing_skill_pack_rules;
    drop table if exists agent_prompt_bundles;
    drop table if exists agent_skill_packs;
    drop table if exists agent_prompt_families;
    drop table if exists agent_role_charters;
    drop table if exists agent_library_releases;

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
  `).execute(db)
}
