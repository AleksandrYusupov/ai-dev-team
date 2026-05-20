# S50 — Webhook Contract & Signature Validator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Validates webhook contracts: URL registration, signature verification scheme (HMAC-SHA256, Ed25519, etc.), replay protection, payload schema, and failure handling definition.
- Why: Webhook integrations silently break when signature algorithms are undocumented, replay protection is missing, or payload schemas drift undetected.

## When To Use
- When registering or updating a webhook endpoint for any external integration.
- When reviewing an existing webhook contract for compliance before go-live or after a vendor API change.
- When IntegrationAgent (A21) or SecurityAgent (A13) needs to confirm that a webhook meets minimum security and reliability requirements.
- Do NOT use for general API endpoint validation — this skill is specifically for webhook delivery contracts and their signature/replay guarantees.

## Inputs
- Webhook registration record: callback URL, HTTP method, expected headers, TLS requirements.
- Signature verification config: algorithm (HMAC-SHA256, Ed25519, RSA-SHA256, etc.), header name, signing key alias (never raw key).
- Replay protection config: timestamp header, nonce header, maximum allowed drift.
- Payload schema: expected event types, JSON schema or sample payloads, content-type.
- Failure handling definition: retry policy, timeout thresholds, dead-letter queue target.

## Steps

1. **Validate webhook URL registration** — confirm the callback URL is:
   - Registered in the integration registry with a known owner.
   - HTTPS-only (reject plain HTTP endpoints unconditionally).
   - Reachable from the expected sender network (not localhost, not internal-only unless explicitly scoped).
   - Associated with a valid TLS certificate (not expired, not self-signed in production).
2. **Verify signature algorithm documentation** — confirm:
   - The signature algorithm is explicitly documented (HMAC-SHA256, Ed25519, RSA-SHA256, etc.).
   - The signing key is referenced by alias or handle only — raw key values must never appear in the contract.
   - The signature header name and computation method are specified (e.g., `X-Hub-Signature-256: sha256=<hex>`).
   - The verification code uses constant-time comparison (flag if not confirmed).
3. **Assess replay protection** — verify the contract includes:
   - A timestamp field with a documented header or payload location.
   - A maximum timestamp drift window (default: 5 minutes; flag if undefined or >10 minutes).
   - A nonce or delivery ID for deduplication (optional but recommended; flag if absent).
   - Documentation of what happens when replay protection rejects a delivery (4xx response, logging, alerting).
4. **Validate payload schema** — confirm:
   - Event types are enumerated and mapped to handler logic.
   - A JSON schema, OpenAPI fragment, or sample payload exists for each event type.
   - Content-Type expectations are documented (e.g., `application/json`).
   - Unknown event types have a defined handling strategy (ignore with 200, log, or reject).
5. **Check failure handling definition** — verify:
   - Retry policy is documented (exponential backoff, max retries, retry window).
   - Timeout thresholds are set for webhook handler response (recommend <=30s).
   - A dead-letter queue or failure log target is defined for undeliverable events.
   - Alerting is configured for sustained delivery failures.
6. **Produce validation report** — emit `webhook_contract_validation_report` containing:
   - Per-check pass/fail/warn status.
   - List of missing or incomplete contract elements.
   - Recommended remediation actions for each finding.
   - Overall contract readiness verdict: `ready`, `needs_remediation`, or `blocked`.

## Stop Conditions
- **Done** when all five validation checks have been evaluated and the report is emitted.
- **Done** when the contract is confirmed as `ready` or all `blocked`/`needs_remediation` items are documented.
- **Never skip** — even a seemingly complete contract must be validated. Absence of findings is a valid positive result.

## Escalation Rules
- Escalate when the webhook uses plain HTTP and no override is documented.
- Escalate when the signature algorithm is missing or unrecognized.
- Escalate when replay protection is entirely absent and the vendor does not support it.
- Do NOT escalate for minor documentation gaps that can be remediated inline.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not include raw signing keys, secrets, or tokens in the validation report.** Use aliases and handles only.
- **Do not approve a contract missing signature verification.** Flag it as `blocked` unconditionally.
- **Do not assume replay protection exists if it is not explicitly documented.**

## Denied Actions
- Do not store or log raw webhook signing secrets anywhere in the validation output.
- Do not bypass HTTPS requirement for production endpoints under any circumstance.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
