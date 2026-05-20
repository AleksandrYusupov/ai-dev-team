# S46 — Integration Type & Auth Scheme Classifier

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Определяет provider_name, integration_kind и auth_scheme: external_api / service_to_service / webhook; api_key / basic / hmac / oauth2_auth_code / oauth2_client_credentials / oauth2_device / webhook_signature / mtls.
- Why: Первая развилка для IntegrationAgent и IntakeAgent: от неё зависит контракт, gating, runner policy и уровень human involvement.

## When To Use
- Определяет provider_name, integration_kind и auth_scheme: external_api / service_to_service / webhook; api_key / basic / hmac / oauth2_auth_code / oauth2_client_credentials / oauth2_device / webhook_signature / mtls.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Входы: issue brief, vendor docs, existing adapters, prior decisions. Выходы: classification + confidence + rationale + missing prerequisites + recommended next steps. Должен уметь распознавать ambiguous/mixed auth модели и эскалировать low-confidence cases.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Входы: issue brief, vendor docs, existing adapters, prior decisions. Выходы: classification + confidence + rationale + missing prerequisites + recommended next steps. Должен уметь распознавать ambiguous/mixed auth модели и эскалировать low-confidence cases.

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
