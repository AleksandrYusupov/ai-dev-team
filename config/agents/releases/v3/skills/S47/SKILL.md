# S47 — Integration Brief & Auth Decision Record Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Generates two structured artifacts — integration_brief (for delivery agents) and auth_decision_record (for SecurityAgent and governance). Documents auth model, scopes, redirect URIs, webhook URLs, consent requirements, sandbox state, and go-live checklist. All auth references are sanitized metadata only.
- Why: This is the primary artifact that separates discovery/gating from code implementation. Downstream agents (BuildAgent-Integrations, SecurityAgent) consume these artifacts as their contract.

## When To Use
- When S46 has produced a classification record and the integration lifecycle needs its planning artifacts before any code is written.
- When IntegrationAgent (A21) is preparing the handoff package that BuildAgent-Integrations will consume.
- When SecurityAgent (A13) requests an auth decision record to review scopes, consent model, and boundary rules.
- Do NOT use when the classification record from S46 is missing or has confidence < 0.7 — run S46 first.

## Inputs
- S46 classification record: `provider_name`, `integration_kind`, `auth_scheme`, `confidence`, `rationale`.
- Vendor API documentation: endpoints, rate limits, pagination model, error codes.
- Scope and permission requirements from the vendor's developer console.
- Existing integration_brief or auth_decision_record (if updating rather than creating).
- Runner environment metadata (from S49, if available).

## Steps

1. **Build integration_brief** — assemble the delivery-facing artifact:
   - `provider_name`, `integration_kind`, `auth_scheme` (from S46).
   - `endpoints`: list of API endpoints or webhook URLs the integration will use.
   - `scopes`: OAuth scopes or permission sets required.
   - `rate_limits`: documented rate limits, quotas, and retry policies.
   - `error_model`: expected error codes, retry-eligible statuses, circuit-breaker thresholds.
   - `pagination`: pagination style (cursor, offset, keyset) and page size limits.
   - `sandbox_state`: whether a sandbox/test environment exists and its current status.
   - `test_strategy`: how the integration will be validated (sandbox calls, mocked responses, contract tests).

2. **Build auth_decision_record** — assemble the governance artifact:
   - `auth_scheme` and `auth_flow_summary`: human-readable description of the auth lifecycle.
   - `scopes_rationale`: why each scope is required (principle of least privilege).
   - `redirect_uris`: list of OAuth redirect URIs (metadata only — no tokens).
   - `webhook_urls`: callback URLs the provider will POST to.
   - `consent_requirements`: what browser-based or manual consent steps are needed.
   - `security_assumptions`: trust boundary, token storage location (by alias), rotation policy.
   - `human_gated_actions`: explicit list of actions that require human console interaction.
   - `non_goals`: what this integration deliberately does NOT do.
   - `ownership`: which team/role owns the integration post-go-live.

3. **Sanitize all references** — verify that neither artifact contains raw credentials:
   - Replace any accidentally included secrets with `[REDACTED:secret_alias:<name>]`.
   - Reference credential store slots by alias only.
   - Invoke F13 (Sensitive Auth Data Boundary Guard) as a final pass.

4. **Assemble go-live checklist** — append to the integration_brief:
   - All credential slots populated (confirmed, not inspected).
   - Sandbox validation passed.
   - Rate limit headroom verified.
   - SecurityAgent review of auth_decision_record complete.
   - Rollback plan documented (disable flag, credential rotation, webhook deregistration).

5. **Link artifacts** — cross-reference the two artifacts:
   - integration_brief references the auth_decision_record by ID.
   - auth_decision_record references the S46 classification record.
   - Both reference the originating Linear issue.

6. **Emit outputs** — deliver `integration_brief`, `auth_decision_record`, and `go_live_checklist` to the calling agent and attach summaries to the Linear issue.

## Stop Conditions
- **Done** when both artifacts are complete, sanitized, cross-linked, and the go-live checklist is attached.
- **Blocked** when required inputs (S46 classification, vendor docs, scope list) are missing — emit a structured `needs_input` request via S48.
- **Done** when updating an existing brief/record and all changed fields have been re-sanitized.

## Escalation Rules
- Escalate when vendor documentation is insufficient to determine scopes or consent requirements.
- Escalate when the auth model requires non-standard flows not covered by S46 schemes.
- Escalate when SecurityAgent rejects the auth_decision_record and remediation is unclear.
- Do NOT escalate for routine artifact generation — this is the happy path.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- Do not include raw secrets, tokens, or credentials in either artifact — metadata and aliases only.
- Do not skip the F13 sanitization pass even if you believe content is clean.
- Do not produce the integration_brief without the auth_decision_record — they are a linked pair.
- Do not treat the integration_brief as a code spec — it is a contract, not implementation guidance.

## Denied Actions
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
- Do not embed vendor-console screenshots or credential-bearing URLs in either artifact.
