import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table repository_registry (
      repo_slug text primary key,
      github_owner text not null,
      github_repo text not null,
      default_branch text not null,
      visibility text not null,
      linear_team_id text not null,
      obsidian_root_note text not null,
      agent_guidance_scope text not null,
      local_checkout_path text null,
      required_checks jsonb not null default '[]'::jsonb,
      environments jsonb not null default '[]'::jsonb,
      repo_kind text not null,
      service_dependencies jsonb not null default '[]'::jsonb,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (github_owner, github_repo)
    );

    create unique index repository_registry_active_root_note_idx
      on repository_registry (obsidian_root_note)
      where is_active = true;

    create table project_repository_mappings (
      id uuid primary key default gen_random_uuid(),
      linear_project_id text not null,
      repo_slug text not null references repository_registry(repo_slug),
      mapping_role text not null check (mapping_role in ('primary', 'affected')),
      priority_order int not null default 100,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (linear_project_id, repo_slug)
    );

    create unique index project_repository_mappings_single_primary_idx
      on project_repository_mappings (linear_project_id)
      where mapping_role = 'primary';

    create index project_repository_mappings_lookup_idx
      on project_repository_mappings (linear_project_id, mapping_role, priority_order asc);

    create table linear_issue_contract_snapshots (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      snapshot_hash text not null,
      primary_repo text null,
      affected_repos jsonb not null default '[]'::jsonb,
      docs_links jsonb not null default '[]'::jsonb,
      risk text null,
      dependencies jsonb not null default '{}'::jsonb,
      contract_json jsonb not null,
      created_at timestamptz not null default now(),
      unique (issue_id, snapshot_hash),
      constraint linear_issue_contract_snapshots_primary_repo_fk
        foreign key (primary_repo)
        references repository_registry(repo_slug)
    );

    create index linear_issue_contract_snapshots_latest_idx
      on linear_issue_contract_snapshots (issue_id, created_at desc);

    create table knowledge_note_snapshots (
      id uuid primary key default gen_random_uuid(),
      note_path text not null,
      note_title text not null,
      root_tag text not null,
      content_hash text not null,
      resolved_links jsonb not null default '[]'::jsonb,
      sanitized_markdown text not null,
      summary_markdown text not null,
      source_updated_at timestamptz null,
      ingested_at timestamptz not null default now(),
      snapshot_status text not null check (snapshot_status in ('fresh', 'stale', 'failed')),
      last_error text null,
      unique (note_path, content_hash)
    );

    create index knowledge_note_snapshots_latest_idx
      on knowledge_note_snapshots (note_path, ingested_at desc);

    create index knowledge_note_snapshots_status_idx
      on knowledge_note_snapshots (snapshot_status, ingested_at desc);

    create table context_pack_cache (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      context_version int not null,
      input_fingerprint text not null,
      bundle_json jsonb not null,
      estimated_tokens int not null,
      source_trace_json jsonb not null,
      created_at timestamptz not null default now(),
      superseded_at timestamptz null,
      unique (issue_id, context_version)
    );

    create unique index context_pack_cache_active_fingerprint_idx
      on context_pack_cache (issue_id, input_fingerprint)
      where superseded_at is null;

    create index context_pack_cache_latest_idx
      on context_pack_cache (issue_id, created_at desc);
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists context_pack_cache;
    drop table if exists knowledge_note_snapshots;
    drop table if exists linear_issue_contract_snapshots;
    drop table if exists project_repository_mappings;
    drop table if exists repository_registry;
  `).execute(db)
}
