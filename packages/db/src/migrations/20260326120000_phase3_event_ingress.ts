import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table raw_event_inbox (
      id uuid primary key default gen_random_uuid(),
      provider text not null check (provider in ('linear', 'github')),
      provider_event_type text not null,
      provider_action text null,
      delivery_id text not null,
      signature_status text not null check (signature_status in ('verified', 'failed', 'missing')),
      provider_timestamp timestamptz null,
      received_at timestamptz not null default now(),
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      delivery_attempt_count int not null default 1,
      request_headers jsonb not null,
      raw_body text not null,
      parsed_payload jsonb not null,
      canonical_envelope jsonb null,
      processing_status text not null default 'received' check (
        processing_status in (
          'received',
          'duplicate',
          'normalized',
          'dispatched',
          'ignored',
          'failed',
          'dead_letter'
        )
      ),
      processing_attempt_count int not null default 0,
      processed_at timestamptz null,
      last_error text null,
      issue_id text null,
      comment_id text null,
      project_id text null,
      repository_full_name text null,
      dedupe_scope text not null default 'provider_delivery_id',
      created_at timestamptz not null default now(),
      unique (provider, delivery_id)
    );

    create index raw_event_inbox_processing_idx
      on raw_event_inbox (processing_status, received_at);
    create index raw_event_inbox_provider_event_idx
      on raw_event_inbox (provider, provider_event_type, received_at desc);
    create index raw_event_inbox_issue_idx
      on raw_event_inbox (issue_id, received_at desc);
    create index raw_event_inbox_repository_idx
      on raw_event_inbox (repository_full_name, received_at desc);

    create table comment_log (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_comment_id text not null,
      source_inbox_event_id uuid not null references raw_event_inbox(id),
      author_actor_type text not null,
      author_actor_id text not null,
      body_markdown text not null,
      contains_ask boolean not null,
      classification text not null check (
        classification in (
          'informational',
          'prompt',
          'answer_candidate',
          'manual_override_candidate',
          'deleted'
        )
      ),
      source_created_at timestamptz not null,
      source_updated_at timestamptz null,
      deleted_at timestamptz null,
      metadata jsonb not null default '{}'::jsonb,
      ingested_at timestamptz not null default now(),
      unique (provider_comment_id)
    );

    create index comment_log_issue_created_idx
      on comment_log (issue_id, source_created_at asc);
    create index comment_log_issue_classification_idx
      on comment_log (issue_id, classification, source_created_at desc);
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists comment_log;
    drop table if exists raw_event_inbox;
  `).execute(db)
}
