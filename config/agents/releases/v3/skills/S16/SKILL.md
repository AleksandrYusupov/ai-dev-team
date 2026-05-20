# S16 — Integration/API Builder Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Работа с third-party APIs, retries, rate limits, idempotency keys, webhook handling, auth, schema drift и безопасным потреблением secret aliases/handles вместо raw credentials.
- Why: Для BuildAgent-Integrations под контролем IntegrationAgent.

## When To Use
- When BuildAgent-Integrations (A08) receives a task to build or modify a third-party API client, webhook handler, or external service integration.
- When the task involves retry/backoff logic, rate limit handling, idempotency keys, or failure classification for external calls.
- When webhook signature verification, schema drift detection, or DLQ/replay hooks are required.
- Do NOT use for internal service-to-service calls within the same system boundary — those belong to S14.

## Inputs
- Integration brief (from IntegrationAgent A21): target API, operations required, SLA expectations, rate limits, auth method.
- Auth decision record (from A21): auth flow type, secret alias/handle (never raw credentials), token refresh strategy.
- Webhook contract (from A21, if applicable): event types, payload schemas, signature algorithm, delivery guarantees.
- Context pack (from F02): architecture constraints, conventions, dependencies.
- Repo guidance (from F03): language, HTTP client library, test framework, mock/stub conventions.

## Steps

1. **Read integration brief and auth record** — consume the integration brief and auth decision record from IntegrationAgent. Identify: target API, required operations, auth method, rate limits, SLA. Confirm that only secret aliases/handles are present — if raw secrets appear, stop and escalate immediately.
2. **Check repo conventions** — read effective conventions from F03. Identify: HTTP client library, retry patterns, error handling idioms, test double conventions. All generated code must conform.
3. **Build resilient API client** — implement the client wrapper with: configurable base URL, typed request/response models, proper header management. Use the repo's HTTP client library. Inject auth via the secret alias/handle, never inline credentials.
4. **Implement retry and backoff** — add retry logic with exponential backoff and jitter for transient failures. Respect the API's rate limit headers (Retry-After, X-RateLimit-*). Configure max retries and timeout from the integration brief's SLA expectations.
5. **Add idempotency keys** — for state-mutating API calls, generate and attach idempotency keys. Store the key-to-request mapping so retries are safe. Follow the target API's idempotency protocol if documented.
6. **Classify failures** — implement failure classification: transient (network timeout, 429, 503) vs permanent (400, 401, 404). Route transient failures to retry. Route permanent failures to structured error responses with actionable context.
7. **Build webhook handler** — if the integration brief includes webhooks: implement the receiver endpoint, verify signatures using the algorithm from the webhook contract, parse and validate payloads against the expected schema, and acknowledge receipt before processing.
8. **Add DLQ and replay hooks** — for both outbound calls and inbound webhooks, implement dead-letter queue routing for exhausted retries and unprocessable messages. Include replay hooks so failed items can be reprocessed without code changes.
9. **Detect schema drift** — add runtime validation of API responses and webhook payloads against expected schemas. Log warnings on unexpected fields. Fail loudly on missing required fields. This catches API version drift before it causes silent data corruption.
10. **Build test doubles** — create mock/stub implementations of the external API for use in tests. Cover: success path, transient failure with retry success, permanent failure, rate limit hit, webhook signature valid/invalid, schema drift scenarios.
11. **Run tests and prepare diff** — execute tests for all integration code. Verify retry, failure classification, and webhook handling paths. Produce a clean diff with PR notes covering: what API is integrated, auth method (alias only), failure handling strategy, test coverage.

## Stop Conditions
- **Done** when the client, webhook handler (if applicable), test doubles, and DLQ hooks are implemented and all tests pass.
- **Done** when failure classification covers all expected error codes and retry behavior is verified by tests.
- **Stop early** if raw secrets are found in any input artifact — escalate to IntegrationAgent immediately.

## Escalation Rules
- Escalate when raw secrets or credentials appear in any input — this is a security boundary violation.
- Escalate when the integration brief is incomplete (missing auth method, rate limits, or required operations).
- Escalate when the target API's behavior contradicts the integration brief (e.g., undocumented auth requirements).
- Do NOT escalate for minor API response variations — handle via schema drift detection and logging.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not hardcode secrets, tokens, or API keys.** Consume only secret aliases/handles from the auth decision record.
- **Do not build integration logic without an integration brief.** The brief is the contract — no brief, no code.
- **Do not retry permanent failures.** 400 and 401 errors must not enter the retry loop.
- **Do not ignore rate limit headers.** Always respect Retry-After and rate limit signals from the target API.
- **Do not skip webhook signature verification.** Unverified webhooks are a security risk.
- **Do not build against live APIs in tests.** Use test doubles exclusively.

## Denied Actions
- Do not access, store, or log raw secrets, tokens, or credentials.
- Do not call external APIs during test execution — use test doubles only.
- Do not modify the integration brief or auth decision record — those are owned by IntegrationAgent (A21).
- Do not merge or push — only prepare the diff for review.
