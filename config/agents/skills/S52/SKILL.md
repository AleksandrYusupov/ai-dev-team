# S52 — Integration Validation & Smoke Testing Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Runs smoke tests for integrations in sandbox environments: auth flow verification, sandbox API calls, webhook delivery simulation, and error response handling validation.
- Why: Even well-built integration code is worthless if the auth flow, API responses, webhook delivery, and error handling have not been verified against a real sandbox before go-live.

## When To Use
- When an integration implementation is code-complete and needs pre-go-live validation in a sandbox environment.
- When IntegrationAgent (A21) or TestAgent (A11) needs to verify that an integration works end-to-end before promotion.
- When OrchestratorAgent (A00) requires smoke test evidence as a gate for the go-live checklist (S53).
- Do NOT use against production environments — this skill targets sandbox/staging only. Production validation is handled by post-deploy monitoring (S54).

## Inputs
- Integration spec: provider name, API version, endpoint list, expected scopes.
- Sandbox credentials reference: credential alias or handle pointing to the sandbox credential store (never raw values).
- Webhook test config: test endpoint URL, expected event types, simulated payload templates.
- Expected response contracts: success response schemas, known error codes, rate limit behavior.
- Smoke test manifest: ordered list of test scenarios with expected outcomes.

## Steps

1. **Verify sandbox environment targeting** — before any test execution, confirm:
   - The target environment is explicitly marked as `sandbox`, `staging`, or `development`.
   - No production URLs, production credential aliases, or production API keys are referenced.
   - The sandbox environment is reachable and returning expected health-check responses.
   - Log the environment identifier in the test report header for auditability.
2. **Run auth flow verification** — execute the authentication flow end-to-end:
   - OAuth: verify token exchange completes, scopes match expected values, refresh flow works.
   - API key: verify the key authenticates successfully and returns expected permission level.
   - Record: auth method, granted scopes, token expiry (metadata only — no raw tokens in output).
   - Fail the smoke run immediately if auth fails — no point testing downstream with broken auth.
3. **Execute sandbox API calls** — for each endpoint in the integration spec:
   - Send a representative request with valid parameters and verify the response schema matches.
   - Send a request with invalid parameters and verify the error response matches the expected contract.
   - Test rate limit behavior: confirm the integration handles 429 responses with appropriate backoff.
   - Record: endpoint, HTTP status, response time, schema match result, rate limit handling.
4. **Simulate webhook delivery** — verify the webhook handler in the sandbox:
   - Send a test webhook payload with a valid signature and verify it is accepted (2xx response).
   - Send a test webhook payload with an invalid signature and verify it is rejected (4xx response).
   - Send a duplicate delivery ID and verify idempotency handling (accepted but not re-processed).
   - Record: delivery ID, event type, handler response code, processing result, idempotency behavior.
5. **Validate error response handling** — confirm the integration handles failure modes:
   - Provider downtime: verify timeout handling and retry/circuit-breaker activation.
   - Malformed responses: verify the integration does not crash on unexpected payload shapes.
   - Auth expiry mid-flow: verify the integration attempts token refresh before failing.
   - Record: failure mode, handler behavior, recovery action, user-facing error message (if applicable).
6. **Produce smoke test report** — emit `integration_smoke_report` containing:
   - Per-scenario pass/fail status with evidence (response codes, timing, schema match).
   - Overall smoke verdict: `passed`, `partial_pass` (non-critical failures), or `failed`.
   - List of failed scenarios with root cause and remediation guidance.
   - Environment confirmation: sandbox identifier, timestamp, credential alias used (no raw values).

## Stop Conditions
- **Done** when all smoke scenarios have been executed and the report is emitted.
- **Done early** if auth verification fails — skip remaining tests and report `failed` with auth as the blocking reason.
- **Never run against production.** If production targeting is detected at any step, abort immediately and escalate.

## Escalation Rules
- Escalate when sandbox credentials are missing, expired, or insufficient for the required scopes.
- Escalate when the sandbox environment is unreachable or returns unexpected health-check failures.
- Escalate when production environment targeting is detected at any point during execution.
- Do NOT escalate for individual API test failures — document them in the report for remediation.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not include raw API responses containing secrets or tokens in the smoke report.** Sanitize all output.
- **Do not skip auth verification and proceed to API tests.** Auth is a hard prerequisite.
- **Do not treat partial_pass as equivalent to passed.** Non-critical failures must still be documented and tracked.
- **Do not run "just one quick test" against production.** Sandbox only, unconditionally.

## Denied Actions
- Do not execute any test against a production environment.
- Do not store or log raw credentials, tokens, or signing secrets in test output.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
