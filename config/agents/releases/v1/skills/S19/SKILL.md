# S19 — Test Strategy Generator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Выбирает нужный баланс unit/integration/e2e/contract tests и negative cases.
- Why: Помогает TestAgent не писать лишнее и не упускать важное.

## When To Use
- Выбирает нужный баланс unit/integration/e2e/contract tests и negative cases.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Вход: risk, component type, blast radius, affected layers. Выход: test plan + priorities.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Вход: risk, component type, blast radius, affected layers. Выход: test plan + priorities.

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
