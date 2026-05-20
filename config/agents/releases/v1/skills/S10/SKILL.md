# S10 — Cross-Repo Impact Analyzer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Оценивает, какие сервисы/репозитории/consumers затронет изменение.
- Why: Нужен для multi-repo изменений и release planning.

## When To Use
- Оценивает, какие сервисы/репозитории/consumers затронет изменение.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Строить affected_repos/services/owners/checks/deployments map.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Строить affected_repos/services/owners/checks/deployments map.

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
