import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

const linearStateMappingValuesSql = `
  values
    ('triage', 'Triage', true),
    ('rework', 'Rework', true),
    ('needs_spec', 'Needs Spec', true),
    ('needs_input', 'Needs Input', true),
    ('planned', 'Planned', true),
    ('ready_for_build', 'Ready for Build', true),
    ('coding', 'Coding', true),
    ('agent_review', 'Agent Review', true),
    ('blocked', 'Blocked', true),
    ('needs_human_decision', 'Needs Human Decision', true),
    ('ready_to_merge', 'Ready to Merge', true),
    ('deploying', 'Deploying', true),
    ('monitoring', 'Monitoring', true),
    ('done', 'Done', true),
    ('canceled', 'Canceled', true),
    ('duplicate', 'Duplicate', true)
`

const linearMilestonePolicyValuesSql = `
  values
    ('pr_opened', 'PR opened', true, false, null),
    ('ci_failed', 'CI failed', true, true, 'atRisk'),
    ('ci_green', 'CI green', true, false, null),
    ('deploy_failed', 'Deploy failed', true, true, 'offTrack'),
    ('deploy_healthy', 'Deploy healthy', true, true, 'onTrack')
`

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table workflow_effect_outbox
      alter column transition_audit_id drop not null;

    create table workflow_linear_state_mappings (
      id uuid primary key default gen_random_uuid(),
      status_code text not null,
      linear_state_name text null,
      sync_enabled boolean not null default true,
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (status_code, config_version),
      constraint workflow_linear_state_mappings_status_fk
        foreign key (status_code, config_version)
        references workflow_status_catalog(code, config_version)
    );

    create index workflow_linear_state_mappings_config_idx
      on workflow_linear_state_mappings (config_version, status_code);

    create table workflow_linear_milestone_policies (
      id uuid primary key default gen_random_uuid(),
      event_code text not null check (
        event_code in (
          'pr_opened',
          'ci_failed',
          'ci_green',
          'deploy_failed',
          'deploy_healthy'
        )
      ),
      event_label text not null,
      post_comment boolean not null default true,
      create_project_update boolean not null default false,
      project_update_health text null check (
        project_update_health in ('onTrack', 'atRisk', 'offTrack')
      ),
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (event_code, config_version)
    );

    create index workflow_linear_milestone_policies_config_idx
      on workflow_linear_milestone_policies (config_version, event_code);

    create table issue_linear_sync_projection (
      issue_id text not null,
      repo_slug text not null references repository_registry(repo_slug) on delete cascade,
      branch_ref text null,
      pr_number int null,
      pr_url text null,
      pr_state text null,
      latest_check_conclusion text null,
      latest_check_url text null,
      latest_deployment_env text null,
      latest_deployment_state text null,
      latest_deployment_url text null,
      last_synced_payload_hash text null,
      last_sync_outcome text null check (
        last_sync_outcome in ('pending', 'succeeded', 'failed')
      ),
      last_sync_error text null,
      last_sync_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (issue_id, repo_slug)
    );

    create index issue_linear_sync_projection_issue_idx
      on issue_linear_sync_projection (issue_id, updated_at desc);
    create index issue_linear_sync_projection_repo_branch_idx
      on issue_linear_sync_projection (repo_slug, branch_ref)
      where branch_ref is not null;
    create index issue_linear_sync_projection_repo_pr_idx
      on issue_linear_sync_projection (repo_slug, pr_number)
      where pr_number is not null;
  `).execute(db)

  await sql.raw(`
    insert into workflow_linear_state_mappings (
      status_code,
      linear_state_name,
      sync_enabled,
      config_version
    )
    select
      mapping.status_code,
      mapping.linear_state_name,
      mapping.sync_enabled,
      catalog.config_version
    from (${linearStateMappingValuesSql}) as mapping(
      status_code,
      linear_state_name,
      sync_enabled
    )
    inner join workflow_status_catalog as catalog
      on catalog.code = mapping.status_code
    on conflict (status_code, config_version) do nothing;

    insert into workflow_linear_milestone_policies (
      event_code,
      event_label,
      post_comment,
      create_project_update,
      project_update_health,
      config_version
    )
    select
      policy.event_code,
      policy.event_label,
      policy.post_comment,
      policy.create_project_update,
      policy.project_update_health,
      config.config_version
    from workflow_config_sets as config
    cross join (${linearMilestonePolicyValuesSql}) as policy(
      event_code,
      event_label,
      post_comment,
      create_project_update,
      project_update_health
    )
    on conflict (event_code, config_version) do nothing;
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists issue_linear_sync_projection;
    drop table if exists workflow_linear_milestone_policies;
    drop table if exists workflow_linear_state_mappings;

    delete from workflow_effect_outbox
    where transition_audit_id is null;

    alter table workflow_effect_outbox
      alter column transition_audit_id set not null;
  `).execute(db)
}
