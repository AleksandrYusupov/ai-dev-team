# F01 — Issue Contract Parser

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- Why: Даёт всем агентам одинаковую исходную модель задачи и резко снижает дрейф смысла между triage/spec/build/review.

## When To Use
- Разбирает Linear issue/comment thread в нормализованный machine-readable contract: goal, scope, non-goals, acceptance criteria, verification path, repo, affected repos, risk, dependencies, open questions и, при необходимости, integration-specific fields.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Входы: issue body, labels, status, project, comments, links. Выход: JSON contract + confidence + missing_fields. Должен уметь учитывать @ask, timestamps, decisions summary, repo registry и optional integration fields: provider_name, integration_kind, auth_scheme, required_credentials, secret_slots, required_scopes, oauth_redirect_uris, webhook_callback_urls, test_strategy, go_live_checklist, rollback_plan.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Входы: issue body, labels, status, project, comments, links. Выход: JSON contract + confidence + missing_fields. Должен уметь учитывать @ask, timestamps, decisions summary, repo registry и optional integration fields: provider_name, integration_kind, auth_scheme, required_credentials, secret_slots, required_scopes, oauth_redirect_uris, webhook_callback_urls, test_strategy, go_live_checklist, rollback_plan.

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
