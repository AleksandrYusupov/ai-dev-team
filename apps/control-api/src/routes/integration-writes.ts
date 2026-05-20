import type { FastifyPluginAsync } from 'fastify'

import type { AuthScheme } from '@ai-dev-team/shared'

import type { IntegrationWriteRepository } from '../integrations.js'

interface IntegrationWriteRoutesOptions {
  integrationWriteRepository: IntegrationWriteRepository
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw Object.assign(new Error(`Missing or invalid ${fieldName}`), {
      statusCode: 422,
      code: 'invalid_integration_request',
    })
  }

  return value.trim()
}

function optionalNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
}

export const integrationWriteRoutes: FastifyPluginAsync<IntegrationWriteRoutesOptions> = async (
  app,
  { integrationWriteRepository },
) => {
  app.post('/internal/integrations/credential-slots', async (request) => {
    const body = request.body as Record<string, unknown>

    return integrationWriteRepository.createCredentialSlot({
      issueId: requireNonEmptyString(body.issueId, 'issueId'),
      providerName: requireNonEmptyString(body.providerName, 'providerName'),
      credentialKey: requireNonEmptyString(body.credentialKey, 'credentialKey'),
      environment: requireNonEmptyString(body.environment, 'environment'),
      secretAlias: requireNonEmptyString(body.secretAlias, 'secretAlias'),
      ownerActorType: requireNonEmptyString(body.ownerActorType, 'ownerActorType'),
      ownerActorId: requireNonEmptyString(body.ownerActorId, 'ownerActorId'),
      authScheme: requireNonEmptyString(body.authScheme, 'authScheme') as AuthScheme,
      scopes: requireStringArray(body.scopes),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })
  })

  app.patch('/internal/integrations/credential-slots/:slotId/status', async (request, reply) => {
    const slotId = requireNonEmptyString(
      (request.params as { slotId?: unknown }).slotId,
      'slotId',
    )
    const body = request.body as Record<string, unknown>
    const status = requireNonEmptyString(body.status, 'status')

    const result = await integrationWriteRepository.updateCredentialSlotStatus({
      slotId,
      status,
      lastError: optionalNonEmptyString(body.lastError),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })

    if (!result) {
      return reply.status(404).send({
        error: 'credential_slot_not_found',
        message: `Credential slot ${slotId} not found`,
      })
    }

    return result
  })

  app.post('/internal/integrations/oauth-registrations', async (request) => {
    const body = request.body as Record<string, unknown>

    return integrationWriteRepository.createOAuthRegistration({
      issueId: requireNonEmptyString(body.issueId, 'issueId'),
      providerName: requireNonEmptyString(body.providerName, 'providerName'),
      environment: requireNonEmptyString(body.environment, 'environment'),
      clientType: requireNonEmptyString(body.clientType, 'clientType'),
      authScheme: requireNonEmptyString(body.authScheme, 'authScheme'),
      clientIdAlias: requireNonEmptyString(body.clientIdAlias, 'clientIdAlias'),
      clientSecretAlias: optionalNonEmptyString(body.clientSecretAlias),
      redirectUris: requireStringArray(body.redirectUris),
      scopes: requireStringArray(body.scopes),
      registrationState: requireNonEmptyString(body.registrationState, 'registrationState'),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })
  })

  app.post('/internal/integrations/consent-sessions', async (request) => {
    const body = request.body as Record<string, unknown>

    return integrationWriteRepository.createConsentSession({
      issueId: requireNonEmptyString(body.issueId, 'issueId'),
      providerName: requireNonEmptyString(body.providerName, 'providerName'),
      registrationId: optionalNonEmptyString(body.registrationId),
      state: requireNonEmptyString(body.state, 'state'),
      pkceVerifierAlias: optionalNonEmptyString(body.pkceVerifierAlias),
      codeChallengeMethod: optionalNonEmptyString(body.codeChallengeMethod),
      requestedScopes: requireStringArray(body.requestedScopes),
      consentUrl: optionalNonEmptyString(body.consentUrl),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })
  })

  app.post('/internal/integrations/webhooks', async (request) => {
    const body = request.body as Record<string, unknown>

    return integrationWriteRepository.createWebhook({
      issueId: requireNonEmptyString(body.issueId, 'issueId'),
      providerName: requireNonEmptyString(body.providerName, 'providerName'),
      environment: requireNonEmptyString(body.environment, 'environment'),
      callbackUrl: requireNonEmptyString(body.callbackUrl, 'callbackUrl'),
      eventTypes: requireStringArray(body.eventTypes),
      signingSecretAlias: optionalNonEmptyString(body.signingSecretAlias),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })
  })

  app.post('/internal/integrations/validation-runs', async (request) => {
    const body = request.body as Record<string, unknown>

    return integrationWriteRepository.createValidationRun({
      issueId: requireNonEmptyString(body.issueId, 'issueId'),
      providerName: requireNonEmptyString(body.providerName, 'providerName'),
      validationType: requireNonEmptyString(body.validationType, 'validationType'),
      environment: requireNonEmptyString(body.environment, 'environment'),
      summary: optionalNonEmptyString(body.summary),
      metadata: body.metadata as Record<string, never> ?? undefined,
    })
  })
}
