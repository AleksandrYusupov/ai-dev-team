# S51 — Webhook Contract & Signature Hardening Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Enforces concrete hardening rules for webhook handlers: constant-time signature comparison, timestamp drift limits, idempotency key tracking, dead-letter queue for failed deliveries, and no secret values in logs.
- Why: Webhook handlers that pass functional tests still fail security review when timing attacks, replay windows, duplicate processing, or log leaks are not explicitly hardened.

## When To Use
- When building or reviewing webhook handler code to enforce security hardening beyond basic functionality.
- When BuildAgent-Integrations (A08) generates webhook handler implementations that need hardening verification.
- When SecurityAgent (A13) or IntegrationAgent (A21) runs a pre-merge security review on webhook-related code.
- Do NOT use for webhook contract design or registration — use S50 for contract validation; this skill hardens the handler implementation.

## Inputs
- Webhook handler source code or implementation spec.
- Signature verification implementation: algorithm, comparison function, key retrieval method.
- Timestamp and replay handling logic: drift window, nonce storage, deduplication strategy.
- Logging configuration: log format, structured logging fields, log destinations.
- Delivery failure handling: retry behavior, DLQ configuration, alerting hooks.

## Steps

1. **Enforce constant-time signature comparison** — verify the handler:
   - Uses a constant-time comparison function (e.g., `hmac.compare_digest`, `crypto.timingSafeEqual`, `MessageDigest.isEqual`).
   - Does NOT use `==`, `===`, or `.equals()` for signature comparison (flag as `critical` if found).
   - Computes the expected signature server-side from the raw request body (not a parsed/re-serialized version).
   - Rejects requests immediately with 401/403 on signature mismatch before any business logic executes.
2. **Validate timestamp drift limits** — confirm:
   - A maximum timestamp drift window is enforced (default: 5 minutes).
   - The drift window is configurable but has a hard upper bound (recommend <=10 minutes).
   - Requests outside the drift window are rejected with a 401/403 and logged (without secret values).
   - Clock synchronization assumptions are documented (UTC, vendor timestamp format).
3. **Verify idempotency key tracking** — confirm the handler:
   - Extracts a delivery ID or idempotency key from the request (header or payload).
   - Checks the key against a persistent store (DB, cache) before processing.
   - Returns 200 OK for already-processed deliveries without re-executing side effects.
   - Implements TTL-based cleanup for the idempotency store (recommend: 2x the vendor retry window).
4. **Validate dead-letter queue configuration** — confirm:
   - Failed deliveries (handler errors, timeouts, unprocessable payloads) are routed to a DLQ.
   - DLQ entries include: delivery ID, timestamp, event type, error summary, and correlation ID.
   - DLQ entries do NOT include raw secrets, signing keys, or full authorization headers.
   - Alerting is configured for DLQ depth thresholds (e.g., >10 unprocessed in 1 hour).
5. **Audit logging for secret leaks** — scan handler logging to confirm:
   - No raw signing secrets, API keys, or tokens appear in log output at any level (debug, info, error).
   - Signature header values are either omitted or truncated in logs (e.g., first 8 chars + `...`).
   - Request/response body logging, if enabled, redacts sensitive fields before output.
   - Structured logging uses safe field names (e.g., `signature_valid: true/false`, not `signature_value: <raw>`).
6. **Produce hardening report** — emit `webhook_hardening_report` containing:
   - Per-rule pass/fail/critical status.
   - Code locations where violations were found (file, line, function).
   - Recommended fixes with code snippets or patterns.
   - Overall hardening verdict: `hardened`, `needs_fixes`, or `critical_violations`.

## Stop Conditions
- **Done** when all five hardening checks are evaluated and the report is emitted.
- **Done** when all `critical_violations` are documented with remediation guidance.
- **Never skip** — even handlers that "look correct" must be verified. Timing-safe comparison is not visible by reading logic alone.

## Escalation Rules
- Escalate when signature comparison uses non-constant-time equality (critical security finding).
- Escalate when no idempotency mechanism exists and the vendor retries deliveries.
- Escalate when raw secrets are found in production log configurations.
- Do NOT escalate for missing DLQ if the handler has alternative failure tracking (e.g., error table with alerting).

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not include example secret values in hardening report code snippets.** Use placeholders like `SIGNING_SECRET_ALIAS`.
- **Do not weaken drift windows to accommodate poorly synchronized clocks.** Fix the clock, not the window.
- **Do not treat idempotency as optional for handlers with side effects.** Flag as `needs_fixes` at minimum.

## Denied Actions
- Do not store or log raw webhook signing secrets in any hardening output.
- Do not approve non-constant-time signature comparison under any circumstance.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
