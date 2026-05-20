# S49 — Secrets/Auth Plane Metadata Steward

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Работает с metadata-only Secrets/Auth plane: credential_slots, oauth_client_registrations, oauth_consent_sessions, token_handles, webhook_registrations, integration_validation_runs.
- Why: Нужен, чтобы orchestration layer видел readiness/auth state, но не становился секрет-хранилищем.

## When To Use
- Работает с metadata-only Secrets/Auth plane: credential_slots, oauth_client_registrations, oauth_consent_sessions, token_handles, webhook_registrations, integration_validation_runs.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен поддерживать create/read/update flow для metadata-only сущностей, lookup secret aliases/handles, revoke/rotation state, client registration facts и validation run history. Raw secret material, auth codes и bearer tokens сохранять запрещено.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен поддерживать create/read/update flow для metadata-only сущностей, lookup secret aliases/handles, revoke/rotation state, client registration facts и validation run history. Raw secret material, auth codes и bearer tokens сохранять запрещено.

## Stop Conditions
- TODO: define the exact completion boundary.

## Escalation Rules
- Escalate when source-of-truth inputs are missing, contradictory, or blocked by a human-owned zone.
- TODO: add skill-specific escalation thresholds.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- TODO: add skill-specific anti-patterns.

## Denied Actions
- Do not treat this skeleton metadata as runtime-ready execution logic before the later runtime-consumption blocks.
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
