import { sql, type Kysely, type Selectable } from 'kysely'

import {
  INTEGRATION_ARTIFACT_TYPES,
  type CredentialSlotRecordV1,
  type ContextPackIntegrationArtifact,
  type ContextPackSourceTraceArtifactRef,
  type IntegrationArtifactType,
  type IntegrationValidationRunRecordV1,
  type OAuthClientRegistrationRecordV1,
  type OAuthConsentSessionRecordV1,
  type TokenHandleRecordV1,
  type WebhookRegistrationRecordV1,
} from '@ai-dev-team/shared'

import type { Database, JsonObject, JsonValue } from './schema.js'

function toJsonb<T>(value: T) {
  return sql<T>`${JSON.stringify(value)}::jsonb`
}

const DEFAULT_INTEGRATION_CONTEXT_ARTIFACT_TYPES: readonly IntegrationArtifactType[] =
  INTEGRATION_ARTIFACT_TYPES

const SENSITIVE_CALLBACK_METADATA_KEYS = new Set([
  'access_token',
  'authorization_code',
  'client_secret',
  'code',
  'id_token',
  'refresh_token',
  'secret',
  'token',
])

function normalizeMetadataKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '_')
}

function isSensitiveCallbackMetadataKey(key: string): boolean {
  const normalized = normalizeMetadataKey(key)

  return (
    SENSITIVE_CALLBACK_METADATA_KEYS.has(normalized) ||
    normalized.endsWith('_token') ||
    normalized.endsWith('_secret')
  )
}

function sanitizeCallbackMetadataValue(value: JsonValue): JsonValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeCallbackMetadataValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const sanitized: JsonObject = {}

  for (const [key, nestedValue] of Object.entries(value as JsonObject)) {
    if (isSensitiveCallbackMetadataKey(key)) {
      continue
    }

    const sanitizedNestedValue = sanitizeCallbackMetadataValue(nestedValue)

    if (sanitizedNestedValue !== undefined) {
      sanitized[key] = sanitizedNestedValue
    }
  }

  return sanitized
}

function sanitizeCallbackMetadata(metadata: JsonObject): JsonObject {
  const sanitized = sanitizeCallbackMetadataValue(metadata)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as JsonObject)
    : {}
}

function mapCredentialSlot(
  row: Selectable<Database['credential_slots']>,
): CredentialSlotRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    credentialKey: row.credential_key,
    environment: row.environment,
    secretAlias: row.secret_alias,
    ownerActorType: row.owner_actor_type,
    ownerActorId: row.owner_actor_id,
    authScheme: row.auth_scheme,
    status: row.status,
    scopes: row.scopes,
    metadata: row.metadata,
    validationCheckedAt: row.validation_checked_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    rotatedAt: row.rotated_at?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapOAuthClientRegistration(
  row: Selectable<Database['oauth_client_registrations']>,
): OAuthClientRegistrationRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    environment: row.environment,
    clientType: row.client_type,
    authScheme: row.auth_scheme,
    clientIdAlias: row.client_id_alias,
    clientSecretAlias: row.client_secret_alias,
    redirectUris: row.redirect_uris,
    scopes: row.scopes,
    registrationState: row.registration_state,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapOAuthConsentSession(
  row: Selectable<Database['oauth_consent_sessions']>,
): OAuthConsentSessionRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    registrationId: row.registration_id,
    state: row.state,
    pkceVerifierAlias: row.pkce_verifier_alias,
    codeChallengeMethod: row.code_challenge_method,
    requestedScopes: row.requested_scopes,
    grantedScopes: row.granted_scopes,
    status: row.status,
    consentUrl: row.consent_url,
    callbackReceivedAt: row.callback_received_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    lastError: row.last_error,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapTokenHandle(
  row: Selectable<Database['token_handles']>,
): TokenHandleRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    consentSessionId: row.consent_session_id,
    tokenKind: row.token_kind,
    secretAlias: row.secret_alias,
    status: row.status,
    scopes: row.scopes,
    expiresAt: row.expires_at?.toISOString() ?? null,
    rotatedAt: row.rotated_at?.toISOString() ?? null,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lastError: row.last_error,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapWebhookRegistration(
  row: Selectable<Database['webhook_registrations']>,
): WebhookRegistrationRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    environment: row.environment,
    callbackUrl: row.callback_url,
    eventTypes: row.event_types,
    signingSecretAlias: row.signing_secret_alias,
    status: row.status,
    lastValidatedAt: row.last_validated_at?.toISOString() ?? null,
    lastError: row.last_error,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function mapIntegrationValidationRun(
  row: Selectable<Database['integration_validation_runs']>,
): IntegrationValidationRunRecordV1 {
  return {
    schemaVersion: 1,
    id: row.id,
    issueId: row.issue_id,
    providerName: row.provider_name,
    validationType: row.validation_type,
    environment: row.environment,
    status: row.status as IntegrationValidationRunRecordV1['status'],
    summary: row.summary,
    artifactId: row.artifact_id,
    metadata: row.metadata,
    executedAt: row.executed_at.toISOString(),
  }
}

export async function getCredentialSlotsByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<CredentialSlotRecordV1[]> {
  const rows = await db
    .selectFrom('credential_slots')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('provider_name', 'asc')
    .orderBy('credential_key', 'asc')
    .execute()

  return rows.map(mapCredentialSlot)
}

export async function getOAuthClientRegistrationsByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<OAuthClientRegistrationRecordV1[]> {
  const rows = await db
    .selectFrom('oauth_client_registrations')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('provider_name', 'asc')
    .orderBy('environment', 'asc')
    .execute()

  return rows.map(mapOAuthClientRegistration)
}

export async function getOAuthConsentSessionsByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<OAuthConsentSessionRecordV1[]> {
  const rows = await db
    .selectFrom('oauth_consent_sessions')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('created_at', 'desc')
    .execute()

  return rows.map(mapOAuthConsentSession)
}

export async function getTokenHandlesByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<TokenHandleRecordV1[]> {
  const rows = await db
    .selectFrom('token_handles')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('provider_name', 'asc')
    .orderBy('token_kind', 'asc')
    .execute()

  return rows.map(mapTokenHandle)
}

export async function getWebhookRegistrationsByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<WebhookRegistrationRecordV1[]> {
  const rows = await db
    .selectFrom('webhook_registrations')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('provider_name', 'asc')
    .orderBy('environment', 'asc')
    .execute()

  return rows.map(mapWebhookRegistration)
}

export async function getIntegrationValidationRunsByIssueId(
  db: Kysely<Database>,
  issueId: string,
): Promise<IntegrationValidationRunRecordV1[]> {
  const rows = await db
    .selectFrom('integration_validation_runs')
    .selectAll()
    .where('issue_id', '=', issueId)
    .orderBy('executed_at', 'desc')
    .execute()

  return rows.map(mapIntegrationValidationRun)
}

export async function getLatestIntegrationContextArtifacts(
  db: Kysely<Database>,
  issueId: string,
  artifactTypes: readonly IntegrationArtifactType[] =
    DEFAULT_INTEGRATION_CONTEXT_ARTIFACT_TYPES,
): Promise<{
  artifacts: ContextPackIntegrationArtifact[]
  refs: ContextPackSourceTraceArtifactRef[]
}> {
  const rows = await db
    .selectFrom('artifact_registry')
    .select([
      'id',
      'artifact_type',
      'artifact_uri',
      'artifact_summary',
      'produced_by_role',
      'produced_at',
    ])
    .where('issue_id', '=', issueId)
    .where('superseded_at', 'is', null)
    .where('artifact_type', 'in', [...artifactTypes])
    .orderBy('produced_at', 'desc')
    .execute()

  const latestByType = new Map<string, (typeof rows)[number]>()

  for (const row of rows) {
    if (!latestByType.has(row.artifact_type)) {
      latestByType.set(row.artifact_type, row)
    }
  }

  const artifacts = [...latestByType.values()].map<ContextPackIntegrationArtifact>(
    (row) => ({
      artifactId: row.id,
      artifactType: row.artifact_type as IntegrationArtifactType,
      artifactUri: row.artifact_uri,
      artifactSummary: row.artifact_summary,
      producedByRole: row.produced_by_role,
      producedAt: row.produced_at.toISOString(),
    }),
  )

  const refs = artifacts.map<ContextPackSourceTraceArtifactRef>((artifact) => ({
    artifactId: artifact.artifactId,
    artifactType: artifact.artifactType,
    producedAt: artifact.producedAt,
  }))

  return { artifacts, refs }
}

export async function insertCredentialSlot(
  db: Kysely<Database>,
  input: {
    issueId: string
    providerName: string
    credentialKey: string
    environment: string
    secretAlias: string
    ownerActorType: string
    ownerActorId: string
    authScheme: Database['credential_slots']['auth_scheme']
    status: Database['credential_slots']['status']
    scopes: string[]
    metadata?: JsonObject
  },
): Promise<CredentialSlotRecordV1> {
  const row = await db
    .insertInto('credential_slots')
    .values({
      issue_id: input.issueId,
      provider_name: input.providerName,
      credential_key: input.credentialKey,
      environment: input.environment,
      secret_alias: input.secretAlias,
      owner_actor_type: input.ownerActorType,
      owner_actor_id: input.ownerActorId,
      auth_scheme: input.authScheme,
      status: input.status,
      scopes: toJsonb(input.scopes),
      metadata: toJsonb(input.metadata ?? {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return mapCredentialSlot(row)
}

export async function insertOAuthConsentSession(
  db: Kysely<Database>,
  input: {
    issueId: string
    providerName: string
    registrationId: string | null
    state: string
    pkceVerifierAlias: string | null
    codeChallengeMethod: string | null
    requestedScopes: string[]
    status: Database['oauth_consent_sessions']['status']
    consentUrl: string | null
    metadata?: JsonObject
  },
): Promise<OAuthConsentSessionRecordV1> {
  const row = await db
    .insertInto('oauth_consent_sessions')
    .values({
      issue_id: input.issueId,
      provider_name: input.providerName,
      registration_id: input.registrationId,
      state: input.state,
      pkce_verifier_alias: input.pkceVerifierAlias,
      code_challenge_method: input.codeChallengeMethod,
      requested_scopes: toJsonb(input.requestedScopes),
      granted_scopes: toJsonb([]),
      status: input.status,
      consent_url: input.consentUrl,
      metadata: toJsonb(input.metadata ?? {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return mapOAuthConsentSession(row)
}

export async function updateCredentialSlotStatus(
  db: Kysely<Database>,
  input: {
    slotId: string
    status: Database['credential_slots']['status']
    validationCheckedAt?: Date | null
    expiresAt?: Date | null
    rotatedAt?: Date | null
    lastError?: string | null
    metadata?: JsonObject
    updatedAt?: Date
  },
): Promise<CredentialSlotRecordV1 | null> {
  const existing = await db
    .selectFrom('credential_slots')
    .selectAll()
    .where('id', '=', input.slotId)
    .executeTakeFirst()

  if (!existing) {
    return null
  }

  const updated = await db
    .updateTable('credential_slots')
    .set({
      status: input.status,
      validation_checked_at: input.validationCheckedAt ?? existing.validation_checked_at,
      expires_at: input.expiresAt ?? existing.expires_at,
      rotated_at: input.rotatedAt ?? existing.rotated_at,
      last_error:
        input.lastError === undefined ? existing.last_error : input.lastError,
      metadata: toJsonb({
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
      }),
      updated_at: input.updatedAt ?? new Date(),
    })
    .where('id', '=', input.slotId)
    .returningAll()
    .executeTakeFirst()

  return updated ? mapCredentialSlot(updated) : null
}

export async function upsertOAuthClientRegistration(
  db: Kysely<Database>,
  input: {
    issueId: string
    providerName: string
    environment: string
    clientType: Database['oauth_client_registrations']['client_type']
    authScheme: Database['oauth_client_registrations']['auth_scheme']
    clientIdAlias: string
    clientSecretAlias: string | null
    redirectUris: string[]
    scopes: string[]
    registrationState: string
    metadata?: JsonObject
    updatedAt?: Date
  },
): Promise<OAuthClientRegistrationRecordV1> {
  const now = input.updatedAt ?? new Date()
  const row = await db
    .insertInto('oauth_client_registrations')
    .values({
      issue_id: input.issueId,
      provider_name: input.providerName,
      environment: input.environment,
      client_type: input.clientType,
      auth_scheme: input.authScheme,
      client_id_alias: input.clientIdAlias,
      client_secret_alias: input.clientSecretAlias,
      redirect_uris: toJsonb(input.redirectUris),
      scopes: toJsonb(input.scopes),
      registration_state: input.registrationState,
      metadata: toJsonb(input.metadata ?? {}),
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['issue_id', 'provider_name', 'environment', 'client_type'])
        .doUpdateSet({
          auth_scheme: input.authScheme,
          client_id_alias: input.clientIdAlias,
          client_secret_alias: input.clientSecretAlias,
          redirect_uris: toJsonb(input.redirectUris),
          scopes: toJsonb(input.scopes),
          registration_state: input.registrationState,
          metadata: toJsonb(input.metadata ?? {}),
          updated_at: now,
        }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()

  return mapOAuthClientRegistration(row)
}

export async function updateTokenHandleStatus(
  db: Kysely<Database>,
  input: {
    tokenHandleId: string
    status: Database['token_handles']['status']
    expiresAt?: Date | null
    rotatedAt?: Date | null
    lastCheckedAt?: Date | null
    lastError?: string | null
    metadata?: JsonObject
    updatedAt?: Date
  },
): Promise<TokenHandleRecordV1 | null> {
  const existing = await db
    .selectFrom('token_handles')
    .selectAll()
    .where('id', '=', input.tokenHandleId)
    .executeTakeFirst()

  if (!existing) {
    return null
  }

  const updated = await db
    .updateTable('token_handles')
    .set({
      status: input.status,
      expires_at: input.expiresAt ?? existing.expires_at,
      rotated_at: input.rotatedAt ?? existing.rotated_at,
      last_checked_at: input.lastCheckedAt ?? existing.last_checked_at,
      last_error:
        input.lastError === undefined ? existing.last_error : input.lastError,
      metadata: toJsonb({
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
      }),
      updated_at: input.updatedAt ?? new Date(),
    })
    .where('id', '=', input.tokenHandleId)
    .returningAll()
    .executeTakeFirst()

  return updated ? mapTokenHandle(updated) : null
}

export async function upsertWebhookRegistration(
  db: Kysely<Database>,
  input: {
    issueId: string
    providerName: string
    environment: string
    callbackUrl: string
    eventTypes: string[]
    signingSecretAlias: string | null
    status: Database['webhook_registrations']['status']
    lastValidatedAt?: Date | null
    lastError?: string | null
    metadata?: JsonObject
    updatedAt?: Date
  },
): Promise<WebhookRegistrationRecordV1> {
  const now = input.updatedAt ?? new Date()
  const row = await db
    .insertInto('webhook_registrations')
    .values({
      issue_id: input.issueId,
      provider_name: input.providerName,
      environment: input.environment,
      callback_url: input.callbackUrl,
      event_types: toJsonb(input.eventTypes),
      signing_secret_alias: input.signingSecretAlias,
      status: input.status,
      last_validated_at: input.lastValidatedAt ?? null,
      last_error: input.lastError ?? null,
      metadata: toJsonb(input.metadata ?? {}),
      updated_at: now,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['issue_id', 'provider_name', 'environment', 'callback_url'])
        .doUpdateSet({
          event_types: toJsonb(input.eventTypes),
          signing_secret_alias: input.signingSecretAlias,
          status: input.status,
          last_validated_at: input.lastValidatedAt ?? null,
          last_error: input.lastError ?? null,
          metadata: toJsonb(input.metadata ?? {}),
          updated_at: now,
        }),
    )
    .returningAll()
    .executeTakeFirstOrThrow()

  return mapWebhookRegistration(row)
}

export async function insertIntegrationValidationRun(
  db: Kysely<Database>,
  input: {
    issueId: string
    providerName: string
    validationType: string
    environment: string
    status: Database['integration_validation_runs']['status']
    summary: string | null
    artifactId?: string | null
    metadata?: JsonObject
    executedAt?: Date
  },
): Promise<IntegrationValidationRunRecordV1> {
  const row = await db
    .insertInto('integration_validation_runs')
    .values({
      issue_id: input.issueId,
      provider_name: input.providerName,
      validation_type: input.validationType,
      environment: input.environment,
      status: input.status,
      summary: input.summary,
      artifact_id: input.artifactId ?? null,
      metadata: toJsonb(input.metadata ?? {}),
      executed_at: input.executedAt ?? new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return mapIntegrationValidationRun(row)
}

export async function recordOAuthConsentCallback(
  db: Kysely<Database>,
  input: {
    providerName: string
    state: string
    receivedAt: Date
    codePresent: boolean
    error: string | null
    errorDescription: string | null
    grantedScopes: string[]
    metadata: JsonObject
  },
): Promise<OAuthConsentSessionRecordV1 | null> {
  const existing = await db
    .selectFrom('oauth_consent_sessions')
    .selectAll()
    .where('provider_name', '=', input.providerName)
    .where('state', '=', input.state)
    .executeTakeFirst()

  if (!existing) {
    return null
  }

  const sanitizedMetadata = sanitizeCallbackMetadata(input.metadata)
  const metadata: JsonObject = {
    ...(existing.metadata ?? {}),
    ...sanitizedMetadata,
    callback: {
      received: true,
      codePresent: input.codePresent,
      error: input.error,
      errorDescription: input.errorDescription,
      receivedAt: input.receivedAt.toISOString(),
    },
  }

  const updated = await db
    .updateTable('oauth_consent_sessions')
    .set({
      status: input.error ? 'failed' : 'callback_received',
      granted_scopes: toJsonb(input.grantedScopes),
      callback_received_at: input.receivedAt,
      last_error: input.error
        ? [input.error, input.errorDescription].filter(Boolean).join(': ')
        : null,
      metadata: toJsonb(metadata),
      updated_at: input.receivedAt,
    })
    .where('id', '=', existing.id)
    .returningAll()
    .executeTakeFirst()

  return updated ? mapOAuthConsentSession(updated) : null
}
