import { sql, type Kysely } from 'kysely'

import type { Database } from '../schema.js'

export async function up(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    create table credential_slots (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      credential_key text not null,
      environment text not null,
      secret_alias text not null,
      owner_actor_type text not null
        check (owner_actor_type in ('human', 'system', 'agent')),
      owner_actor_id text not null,
      auth_scheme text not null
        check (auth_scheme in (
          'api_key',
          'basic',
          'hmac',
          'oauth2_auth_code',
          'oauth2_client_credentials',
          'oauth2_device',
          'webhook_signature',
          'mtls'
        )),
      status text not null
        check (status in (
          'required',
          'awaiting_upload',
          'uploaded',
          'validated',
          'invalid',
          'expired',
          'revoked'
        )),
      scopes jsonb not null default '[]'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      validation_checked_at timestamptz null,
      expires_at timestamptz null,
      rotated_at timestamptz null,
      last_error text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (issue_id, provider_name, credential_key, environment)
    );

    create index credential_slots_issue_idx
      on credential_slots (issue_id, provider_name, environment);
    create index credential_slots_status_idx
      on credential_slots (status, updated_at desc);

    create table oauth_client_registrations (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      environment text not null,
      client_type text not null
        check (client_type in ('public', 'confidential', 'machine')),
      auth_scheme text not null
        check (auth_scheme in (
          'oauth2_auth_code',
          'oauth2_client_credentials',
          'oauth2_device',
          'mtls'
        )),
      client_id_alias text not null,
      client_secret_alias text null,
      redirect_uris jsonb not null default '[]'::jsonb,
      scopes jsonb not null default '[]'::jsonb,
      registration_state text not null default 'draft'
        check (registration_state in ('draft', 'configured', 'validated', 'retired')),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (issue_id, provider_name, environment, client_type)
    );

    create index oauth_client_registrations_issue_idx
      on oauth_client_registrations (issue_id, provider_name, environment);

    create table oauth_consent_sessions (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      registration_id uuid null references oauth_client_registrations(id) on delete set null,
      state text not null unique,
      pkce_verifier_alias text null,
      code_challenge_method text null,
      requested_scopes jsonb not null default '[]'::jsonb,
      granted_scopes jsonb not null default '[]'::jsonb,
      status text not null
        check (status in (
          'pending',
          'consent_required',
          'callback_received',
          'validated',
          'failed',
          'expired',
          'revoked'
        )),
      consent_url text null,
      callback_received_at timestamptz null,
      completed_at timestamptz null,
      last_error text null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index oauth_consent_sessions_issue_idx
      on oauth_consent_sessions (issue_id, provider_name, created_at desc);
    create index oauth_consent_sessions_status_idx
      on oauth_consent_sessions (status, updated_at desc);

    create table token_handles (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      consent_session_id uuid null references oauth_consent_sessions(id) on delete set null,
      token_kind text not null,
      secret_alias text not null,
      status text not null
        check (status in ('active', 'refresh_required', 'expired', 'revoked', 'invalid')),
      scopes jsonb not null default '[]'::jsonb,
      expires_at timestamptz null,
      rotated_at timestamptz null,
      last_checked_at timestamptz null,
      last_error text null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (issue_id, provider_name, token_kind, secret_alias)
    );

    create index token_handles_issue_idx
      on token_handles (issue_id, provider_name, status);

    create table webhook_registrations (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      environment text not null,
      callback_url text not null,
      event_types jsonb not null default '[]'::jsonb,
      signing_secret_alias text null,
      status text not null
        check (status in ('required', 'registered', 'validated', 'failed', 'disabled')),
      last_validated_at timestamptz null,
      last_error text null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (issue_id, provider_name, environment, callback_url)
    );

    create index webhook_registrations_issue_idx
      on webhook_registrations (issue_id, provider_name, environment);
    create index webhook_registrations_status_idx
      on webhook_registrations (status, updated_at desc);

    create table integration_validation_runs (
      id uuid primary key default gen_random_uuid(),
      issue_id text not null,
      provider_name text not null,
      validation_type text not null,
      environment text not null,
      status text not null
        check (status in ('pending', 'passed', 'failed')),
      summary text null,
      artifact_id uuid null references artifact_registry(id) on delete set null,
      metadata jsonb not null default '{}'::jsonb,
      executed_at timestamptz not null default now()
    );

    create index integration_validation_runs_issue_idx
      on integration_validation_runs (issue_id, provider_name, executed_at desc);
    create index integration_validation_runs_status_idx
      on integration_validation_runs (status, executed_at desc);
  `).execute(db)
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`
    drop table if exists integration_validation_runs;
    drop table if exists webhook_registrations;
    drop table if exists token_handles;
    drop table if exists oauth_consent_sessions;
    drop table if exists oauth_client_registrations;
    drop table if exists credential_slots;
  `).execute(db)
}
