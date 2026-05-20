# S46 — Integration Type & Auth Scheme Classifier

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Determines provider_name, integration_kind (REST, GraphQL, webhook, SDK, file exchange) and auth_scheme (API key, OAuth2 auth code, OAuth2 client credentials, HMAC webhook, mTLS, custom). Outputs a classification record with confidence and rationale.
- Why: First branching point for IntegrationAgent and IntakeAgent: the classification drives the contract shape, gating requirements, runner policy, and level of human involvement.

## When To Use
- When a new integration request arrives and the provider's API style and auth model have not been classified yet.
- When IntakeAgent (A01) needs to tag an inbound issue with integration_kind and auth_scheme before routing.
- When IntegrationAgent (A21) begins the integration lifecycle and needs a structured classification to feed into S47 and S48.
- Do NOT use when the integration has already been classified and the classification record exists with confidence >= 0.7.

## Inputs
- Issue brief or feature request describing the external provider.
- Vendor documentation links, API reference pages, or SDK landing pages.
- Existing adapter code or prior classification records for the same provider (if any).
- Prior auth decision records from related integrations (if any).

## Steps

1. **Extract provider identity** — parse the issue brief and vendor docs to determine:
   - `provider_name`: canonical name of the external service.
   - Provider base URL, API version, and documentation root.
   - Any existing adapters or integrations for the same provider in the codebase.

2. **Classify integration kind** — determine one of the supported kinds:
   - `rest` — standard HTTP request/response against a REST API.
   - `graphql` — query/mutation against a GraphQL endpoint.
   - `webhook` — inbound event delivery from the provider to our runner.
   - `sdk` — vendor-provided client library that wraps API calls.
   - `file_exchange` — batch file upload/download (SFTP, S3, signed URLs).
   - If the provider uses a hybrid model (e.g., REST + webhook), classify the primary kind and note the secondary in rationale.

3. **Classify auth scheme** — determine one of the supported schemes:
   - `api_key` — static key passed in header, query param, or body.
   - `basic` — HTTP Basic with username/password or username/token.
   - `hmac` — webhook payload signature verification (HMAC-SHA256, etc.).
   - `oauth2_auth_code` — OAuth 2.0 Authorization Code flow (requires browser consent).
   - `oauth2_client_credentials` — OAuth 2.0 Client Credentials flow (machine-to-machine).
   - `oauth2_device` — OAuth 2.0 Device Authorization flow.
   - `webhook_signature` — provider signs outbound webhooks with a shared secret.
   - `mtls` — mutual TLS with client certificate.
   - `custom` — vendor-specific auth that does not fit standard schemes.

4. **Assess confidence** — assign a confidence score (0.0 to 1.0):
   - >= 0.9: vendor docs explicitly state API style and auth model.
   - 0.7 - 0.89: strong signals but some ambiguity (e.g., multiple auth options).
   - < 0.7: insufficient evidence; flag for human classification.

5. **Compile classification record** — produce the output object:
   - `provider_name`, `integration_kind`, `auth_scheme`, `confidence`, `rationale`.
   - `missing_prerequisites`: list anything that could not be determined.
   - `recommended_next_steps`: what S47 or S48 should do with this classification.

6. **Emit outputs** — deliver the classification record to the calling agent and tag the Linear issue with `integration_kind` and `auth_scheme` labels.

## Stop Conditions
- **Done** when the classification record is complete with confidence >= 0.7 and all five required fields are populated.
- **Escalate** when confidence < 0.7 — hand off to a human for manual classification with the partial record and rationale attached.
- **Done** when an existing valid classification record is found and no reclassification was requested.

## Escalation Rules
- Escalate when confidence < 0.7 and vendor docs are ambiguous or missing.
- Escalate when the provider uses a non-standard auth model that does not fit any supported scheme.
- Escalate when vendor docs contradict each other or describe deprecated auth flows.
- Do NOT escalate for straightforward classifications — emit the record and move on.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- Do not guess the auth scheme when vendor docs are absent — set confidence low and escalate.
- Do not classify based on assumptions from similarly-named providers — always verify against actual docs.
- Do not embed raw API keys, tokens, or credentials in the classification record or rationale.

## Denied Actions
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
- Do not store vendor-console screenshots or credential-bearing URLs in the classification record.
