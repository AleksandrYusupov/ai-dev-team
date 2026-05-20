import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table workflow_runtime_role_contracts (
      id uuid primary key default gen_random_uuid(),
      role_id text not null,
      canonical_run_kind text null check (
        canonical_run_kind in ('build', 'review', 'deploy', 'rework_cycle')
      ),
      allowed_status_ownership jsonb not null default '[]'::jsonb,
      required_input_artifact_types jsonb not null default '[]'::jsonb,
      required_output_artifact_types jsonb not null default '[]'::jsonb,
      human_gate_policy jsonb not null default '{}'::jsonb,
      escalation_reason_codes jsonb not null default '[]'::jsonb,
      activation_mode text not null check (
        activation_mode in ('active', 'defined_only', 'compatibility_only')
      ),
      config_version int not null references workflow_config_sets(config_version),
      created_at timestamptz not null default now(),
      unique (role_id, config_version)
    );

    create index workflow_runtime_role_contracts_config_idx
      on workflow_runtime_role_contracts (config_version, role_id);
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists workflow_runtime_role_contracts;
  `).execute(db)
}
