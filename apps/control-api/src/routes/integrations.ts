import type { FastifyPluginAsync } from 'fastify'

import type { IntegrationReadRepository } from '../integrations.js'

interface IntegrationRoutesOptions {
  integrationReadRepository: IntegrationReadRepository
  oauthCallbackPathPrefix: string
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

function parseScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return []
  }

  return value
    .split(/[,\s]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim()

  if (trimmed.length === 0 || trimmed === '/') {
    return '/oauth/callback'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`

  return withLeadingSlash.replace(/\/+$/u, '')
}

export const integrationRoutes: FastifyPluginAsync<IntegrationRoutesOptions> = async (
  app,
  { integrationReadRepository, oauthCallbackPathPrefix },
) => {
  app.get('/internal/issues/:issueId/integrations/summary', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return integrationReadRepository.getIssueSummary(issueId)
  })

  app.get('/internal/issues/:issueId/integrations/credential-slots', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getCredentialSlots(issueId),
    }
  })

  app.get('/internal/issues/:issueId/integrations/oauth-registrations', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getOAuthRegistrations(issueId),
    }
  })

  app.get('/internal/issues/:issueId/integrations/oauth-consents', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getOAuthConsentSessions(issueId),
    }
  })

  app.get('/internal/issues/:issueId/integrations/token-handles', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getTokenHandles(issueId),
    }
  })

  app.get('/internal/issues/:issueId/integrations/webhooks', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getWebhookRegistrations(issueId),
    }
  })

  app.get('/internal/issues/:issueId/integrations/validation-runs', async (request) => {
    const issueId = requireNonEmptyString(
      (request.params as { issueId?: unknown }).issueId,
      'issueId',
    )

    return {
      issueId,
      items: await integrationReadRepository.getValidationRuns(issueId),
    }
  })

  app.get(
    `${normalizePathPrefix(oauthCallbackPathPrefix)}/:providerName`,
    async (request, reply) => {
    const providerName = requireNonEmptyString(
      (request.params as { providerName?: unknown }).providerName,
      'providerName',
    )
    const query = request.query as Record<string, unknown>
    const state = requireNonEmptyString(query.state, 'state')
    const code = optionalNonEmptyString(query.code)
    const error = optionalNonEmptyString(query.error)
    const errorDescription = optionalNonEmptyString(query.error_description)
    const scope = optionalNonEmptyString(query.scope)

    const session = await integrationReadRepository.recordOAuthCallback({
      providerName,
      state,
      receivedAt: new Date().toISOString(),
      codePresent: code !== null,
      error,
      errorDescription,
      grantedScopes: parseScopes(scope),
      metadata: {
        source: 'oauth_callback',
        state,
        grantedScopes: parseScopes(scope),
      },
    })

    if (!session) {
      return reply.status(404).send({
        error: 'oauth_consent_session_not_found',
        message: 'No OAuth consent session matched the callback state',
      })
    }

      return reply
        .type('text/html; charset=utf-8')
        .send(
          `<html><body><h1>Consent received</h1><p>Provider: ${providerName}</p><p>Status: ${session.status}</p><p>You can close this window and return to Linear.</p></body></html>`,
        )
    },
  )
}
