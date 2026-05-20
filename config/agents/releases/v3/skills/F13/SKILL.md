# F13 — Sensitive Auth Data Boundary Guard

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Ensures raw secret values, authorization codes, access/refresh tokens, and raw token state never enter Linear comments, Obsidian notes, repo docs, artifact_registry, context packs, or prompt bundles. Passes only sanitized metadata, aliases, handles, and artifact references.
- Why: Separate boundary-control layer so external integration does not turn planning/orchestration/docs into credential storage.

## When To Use
- **Mandatory** before any context pack is finalized — this is not optional.
- When any content sourced from integration callbacks, auth flows, vendor APIs, or credential stores is about to enter a writable surface (context pack, comment, doc, artifact).
- When reviewing content from upstream agents that may contain accidentally leaked sensitive data.
- Do NOT use for general data validation — this skill is specifically for auth/credential boundary enforcement.

## Inputs
- Content to be scanned: context pack draft, comment payloads, callback payloads, artifact content, doc updates, DB write payloads.
- Sensitivity classifier rules: patterns for API keys, tokens, secrets, auth codes, session data.
- Write destination: where the content is going (context_pack, linear_comment, obsidian_note, repo_doc, artifact_registry).

## Steps

1. **Classify content fields** — scan all input content for sensitive data patterns:
   - API keys (patterns: `sk-*`, `key-*`, `Bearer *`, base64 token patterns)
   - OAuth tokens (access tokens, refresh tokens, authorization codes)
   - Raw secret values (passwords, connection strings with credentials)
   - Session data (session IDs with auth context, CSRF tokens)
   - Vendor-specific credential formats (AWS keys, GCP service account JSON, etc.)
2. **Apply boundary rules** — for each detected sensitive field:
   - Determine if the write destination is allowed to contain this type of data.
   - Context packs, Linear comments, Obsidian notes, repo docs, artifact registry, prompt bundles: **NEVER** allowed to contain raw auth data.
   - Only the Secrets/Auth plane (credential store) may contain raw auth truth.
3. **Redact or deny** — for each sensitive field found in content destined for a non-auth-plane surface:
   - **Redact**: replace the raw value with a sanitized reference (e.g., `[REDACTED:secret_alias:oauth_client_secret]`).
   - **Deny write**: if the content cannot be meaningfully sanitized, deny the write and emit a `denied_write` event.
4. **Produce sanitized payload** — output the cleaned content with:
   - All raw auth data replaced by sanitized metadata, aliases, or handles.
   - Integration state summaries (connected/disconnected, scope list, expiry status) preserved without raw values.
   - Artifact references preserved (pointing to the auth plane, not containing auth data).
5. **Generate audit trail** — record:
   - Number of sensitive fields detected.
   - Number of redactions performed.
   - Number of denied writes.
   - Field types that were sensitive (without including the values).
   - Write destinations that were protected.
6. **Emit outputs** — produce: `sanitized_payload`, `denied_write_events` (if any), `safe_summary`, `audit_trail`.

## Stop Conditions
- **Done** when all input content has been scanned and all sensitive data has been redacted or denied.
- **Done** when the audit trail is complete and the sanitized payload is ready.
- **Never skip** — this skill must run to completion even if no sensitive data is expected. Absence of sensitive data is itself a valid (positive) result.

## Escalation Rules
- Escalate when content contains sensitive data that cannot be meaningfully redacted (e.g., an entire payload is a credential blob).
- Escalate when a denied write blocks a critical downstream step.
- Do NOT escalate for routine redactions — they are expected behavior.
- Do NOT escalate for clean scans (no sensitive data found) — this is the happy path.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not log or record the sensitive values you find.** The audit trail tracks types and counts, never values.
- **Do not treat metadata as sensitive.** Integration state (connected/disconnected), scope lists, expiry timestamps, and alias names are safe to include.
- **Do not allow "just this once" exceptions.** The boundary is absolute — no raw auth data in non-auth-plane surfaces, ever.
- **Do not confuse sanitized references with raw values.** `[REDACTED:secret_alias:X]` is safe; the actual value of X is not.

## Denied Actions
- Do not write raw auth data to any non-auth-plane surface.
- Do not store sensitive values in any log, metric, or diagnostic output.
- Do not bypass this skill for "trusted" content — all content is scanned regardless of source.
