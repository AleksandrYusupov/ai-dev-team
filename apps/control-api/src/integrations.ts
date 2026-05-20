import type { DbClient } from '@ai-dev-team/db'
import {
  getCredentialSlotsByIssueId,
  getIntegrationValidationRunsByIssueId,
  getOAuthClientRegistrationsByIssueId,
  getOAuthConsentSessionsByIssueId,
  getTokenHandlesByIssueId,
  getWebhookRegistrationsByIssueId,
  insertCredentialSlot,
  insertIntegrationValidationRun,
  insertOAuthConsentSession,
  recordOAuthConsentCallback,
  updateCredentialSlotStatus,
  upsertOAuthClientRegistration,
  upsertWebhookRegistration,
} from '@ai-dev-team/db'
import type { JsonObject } from '@ai-dev-team/db'
import type {
  AuthScheme,
  CredentialSlotRecordV1,
  IntegrationValidationRunRecordV1,
  OAuthClientRegistrationRecordV1,
  OAuthConsentSessionRecordV1,
  TokenHandleRecordV1,
  WebhookRegistrationRecordV1,
} from '@ai-dev-team/shared'

export interface IntegrationIssueSummaryView {
  issueId: string
  credentialSlotCount: number
  unresolvedCredentialSlotCount: number
  oauthRegistrationCount: number
  oauthConsentStatuses: Record<string, number>
  activeTokenHandleCount: number
  webhookRegistrationCount: number
  validationRunCount: number
  lastValidationAt: string | null
}

export interface RecordOAuthCallbackInput {
  providerName: string
  state: string
  receivedAt: string
  codePresent: boolean
  error: string | null
  errorDescription: string | null
  grantedScopes: string[]
  metadata: JsonObject
}

export interface IntegrationReadRepository {
  getIssueSummary(issueId: string): Promise<IntegrationIssueSummaryView>
  getCredentialSlots(issueId: string): Promise<CredentialSlotRecordV1[]>
  getOAuthRegistrations(issueId: string): Promise<OAuthClientRegistrationRecordV1[]>
  getOAuthConsentSessions(issueId: string): Promise<OAuthConsentSessionRecordV1[]>
  getTokenHandles(issueId: string): Promise<TokenHandleRecordV1[]>
  getWebhookRegistrations(issueId: string): Promise<WebhookRegistrationRecordV1[]>
  getValidationRuns(issueId: string): Promise<IntegrationValidationRunRecordV1[]>
  recordOAuthCallback(
    input: RecordOAuthCallbackInput,
  ): Promise<OAuthConsentSessionRecordV1 | null>
}

export interface CreateCredentialSlotInput {
  issueId: string
  providerName: string
  credentialKey: string
  environment: string
  secretAlias: string
  ownerActorType: string
  ownerActorId: string
  authScheme: AuthScheme
  scopes: string[]
  metadata?: JsonObject
}

export interface UpdateCredentialSlotStatusInput {
  slotId: string
  status: string
  lastError?: string | null
  metadata?: JsonObject
}

export interface CreateOAuthRegistrationInput {
  issueId: string
  providerName: string
  environment: string
  clientType: string
  authScheme: string
  clientIdAlias: string
  clientSecretAlias: string | null
  redirectUris: string[]
  scopes: string[]
  registrationState: string
  metadata?: JsonObject
}

export interface CreateConsentSessionInput {
  issueId: string
  providerName: string
  registrationId: string | null
  state: string
  pkceVerifierAlias: string | null
  codeChallengeMethod: string | null
  requestedScopes: string[]
  consentUrl: string | null
  metadata?: JsonObject
}

export interface CreateWebhookInput {
  issueId: string
  providerName: string
  environment: string
  callbackUrl: string
  eventTypes: string[]
  signingSecretAlias: string | null
  metadata?: JsonObject
}

export interface CreateValidationRunInput {
  issueId: string
  providerName: string
  validationType: string
  environment: string
  summary: string | null
  metadata?: JsonObject
}

export interface IntegrationWriteRepository {
  createCredentialSlot(
    input: CreateCredentialSlotInput,
  ): Promise<CredentialSlotRecordV1>
  updateCredentialSlotStatus(
    input: UpdateCredentialSlotStatusInput,
  ): Promise<CredentialSlotRecordV1 | null>
  createOAuthRegistration(
    input: CreateOAuthRegistrationInput,
  ): Promise<OAuthClientRegistrationRecordV1>
  createConsentSession(
    input: CreateConsentSessionInput,
  ): Promise<OAuthConsentSessionRecordV1>
  createWebhook(
    input: CreateWebhookInput,
  ): Promise<WebhookRegistrationRecordV1>
  createValidationRun(
    input: CreateValidationRunInput,
  ): Promise<IntegrationValidationRunRecordV1>
}

export function createIntegrationReadRepository({
  db,
}: {
  db: DbClient
}): IntegrationReadRepository {
  return {
    async getIssueSummary(issueId: string): Promise<IntegrationIssueSummaryView> {
      const [
        credentialSlots,
        oauthRegistrations,
        oauthConsentSessions,
        tokenHandles,
        webhookRegistrations,
        validationRuns,
      ] = await Promise.all([
        getCredentialSlotsByIssueId(db, issueId),
        getOAuthClientRegistrationsByIssueId(db, issueId),
        getOAuthConsentSessionsByIssueId(db, issueId),
        getTokenHandlesByIssueId(db, issueId),
        getWebhookRegistrationsByIssueId(db, issueId),
        getIntegrationValidationRunsByIssueId(db, issueId),
      ])

      const oauthConsentStatuses = oauthConsentSessions.reduce<Record<string, number>>(
        (accumulator, session) => {
          accumulator[session.status] = (accumulator[session.status] ?? 0) + 1
          return accumulator
        },
        {},
      )

      return {
        issueId,
        credentialSlotCount: credentialSlots.length,
        unresolvedCredentialSlotCount: credentialSlots.filter(
          (slot) => slot.status !== 'validated',
        ).length,
        oauthRegistrationCount: oauthRegistrations.length,
        oauthConsentStatuses,
        activeTokenHandleCount: tokenHandles.filter(
          (tokenHandle) => tokenHandle.status === 'active',
        ).length,
        webhookRegistrationCount: webhookRegistrations.length,
        validationRunCount: validationRuns.length,
        lastValidationAt: validationRuns[0]?.executedAt ?? null,
      }
    },

    getCredentialSlots: (issueId) => getCredentialSlotsByIssueId(db, issueId),
    getOAuthRegistrations: (issueId) =>
      getOAuthClientRegistrationsByIssueId(db, issueId),
    getOAuthConsentSessions: (issueId) =>
      getOAuthConsentSessionsByIssueId(db, issueId),
    getTokenHandles: (issueId) => getTokenHandlesByIssueId(db, issueId),
    getWebhookRegistrations: (issueId) =>
      getWebhookRegistrationsByIssueId(db, issueId),
    getValidationRuns: (issueId) =>
      getIntegrationValidationRunsByIssueId(db, issueId),

    recordOAuthCallback: async (
      input: RecordOAuthCallbackInput,
    ): Promise<OAuthConsentSessionRecordV1 | null> =>
      recordOAuthConsentCallback(db, {
        providerName: input.providerName,
        state: input.state,
        receivedAt: new Date(input.receivedAt),
        codePresent: input.codePresent,
        error: input.error,
        errorDescription: input.errorDescription,
        grantedScopes: input.grantedScopes,
        metadata: input.metadata,
      }),
  }
}

export function createIntegrationWriteRepository({
  db,
}: {
  db: DbClient
}): IntegrationWriteRepository {
  return {
    createCredentialSlot: (input) =>
      insertCredentialSlot(db, {
        ...input,
        status: 'required',
      }),

    updateCredentialSlotStatus: (input) =>
      updateCredentialSlotStatus(db, {
        slotId: input.slotId,
        status: input.status as 'required' | 'awaiting_upload' | 'uploaded' | 'validated' | 'invalid' | 'expired' | 'revoked',
        lastError: input.lastError,
        metadata: input.metadata,
      }),

    createOAuthRegistration: (input) =>
      upsertOAuthClientRegistration(db, {
        issueId: input.issueId,
        providerName: input.providerName,
        environment: input.environment,
        clientType: input.clientType as 'public' | 'confidential' | 'machine',
        authScheme: input.authScheme as 'oauth2_auth_code' | 'oauth2_client_credentials' | 'oauth2_device',
        clientIdAlias: input.clientIdAlias,
        clientSecretAlias: input.clientSecretAlias,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        registrationState: input.registrationState,
        metadata: input.metadata,
      }),

    createConsentSession: (input) =>
      insertOAuthConsentSession(db, {
        issueId: input.issueId,
        providerName: input.providerName,
        registrationId: input.registrationId,
        state: input.state,
        pkceVerifierAlias: input.pkceVerifierAlias,
        codeChallengeMethod: input.codeChallengeMethod,
        requestedScopes: input.requestedScopes,
        status: 'pending',
        consentUrl: input.consentUrl,
        metadata: input.metadata,
      }),

    createWebhook: (input) =>
      upsertWebhookRegistration(db, {
        issueId: input.issueId,
        providerName: input.providerName,
        environment: input.environment,
        callbackUrl: input.callbackUrl,
        eventTypes: input.eventTypes,
        signingSecretAlias: input.signingSecretAlias,
        status: 'required',
        metadata: input.metadata,
      }),

    createValidationRun: (input) =>
      insertIntegrationValidationRun(db, {
        issueId: input.issueId,
        providerName: input.providerName,
        validationType: input.validationType,
        environment: input.environment,
        status: 'pending',
        summary: input.summary,
        metadata: input.metadata,
      }),
  }
}
