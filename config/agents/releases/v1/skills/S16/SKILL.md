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
- Работа с third-party APIs, retries, rate limits, idempotency keys, webhook handling, auth, schema drift и безопасным потреблением secret aliases/handles вместо raw credentials.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен генерировать resilient integration code and test doubles. Обязан уважать integration_brief и auth_decision_record, потреблять только sanitized auth artifacts/aliases, строить retry/backoff/idempotency, логирование, DLQ/replay hooks и failure classification.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен генерировать resilient integration code and test doubles. Обязан уважать integration_brief и auth_decision_record, потреблять только sanitized auth artifacts/aliases, строить retry/backoff/idempotency, логирование, DLQ/replay hooks и failure classification.

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
