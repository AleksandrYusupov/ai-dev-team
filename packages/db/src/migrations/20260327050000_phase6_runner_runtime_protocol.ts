import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    alter table runner_lease_attempts
      add column cancel_requested_at timestamptz null,
      add column cancel_acknowledged_at timestamptz null,
      add column cancel_outcome text null check (
        cancel_outcome in ('accepted', 'already_terminal', 'unsupported')
      );

    create table runner_artifact_blobs (
      artifact_blob_id uuid primary key default gen_random_uuid(),
      lease_attempt_id uuid not null references runner_lease_attempts(lease_attempt_id) on delete cascade,
      artifact_key text not null,
      content_type text not null,
      content_sha256 text not null,
      size_bytes int not null check (size_bytes >= 0),
      content_base64 text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create unique index runner_artifact_blobs_dedupe_idx
      on runner_artifact_blobs (lease_attempt_id, artifact_key, content_sha256);

    create index runner_artifact_blobs_attempt_created_idx
      on runner_artifact_blobs (lease_attempt_id, created_at desc);
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists runner_artifact_blobs;

    alter table runner_lease_attempts
      drop column if exists cancel_outcome,
      drop column if exists cancel_acknowledged_at,
      drop column if exists cancel_requested_at;
  `).execute(db)
}
