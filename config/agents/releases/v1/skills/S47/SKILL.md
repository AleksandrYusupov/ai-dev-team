# S47 — Integration Brief & Auth Decision Record Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Строит integration_brief и auth_decision_record: provider, endpoints, scopes, redirect URIs, callback URLs, rate limits, error model, test strategy, go-live checklist и rollback plan.
- Why: Это главный артефакт, который разделяет discovery/gating и собственно кодовую реализацию.

## When To Use
- Строит integration_brief и auth_decision_record: provider, endpoints, scopes, redirect URIs, callback URLs, rate limits, error model, test strategy, go-live checklist и rollback plan.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Должен выпускать два связанных артефакта: 1) integration_brief для delivery; 2) auth_decision_record с rationale и boundary rules. Включать non-goals, security assumptions, ownership, environments, observability expectations и explicit list of human-gated console actions.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Должен выпускать два связанных артефакта: 1) integration_brief для delivery; 2) auth_decision_record с rationale и boundary rules. Включать non-goals, security assumptions, ownership, environments, observability expectations и explicit list of human-gated console actions.

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
