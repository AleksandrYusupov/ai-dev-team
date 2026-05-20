# S41 — Agent Quality Evaluator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Измеряет качество работы агентов по acceptance pass rate, review bug yield, rework rate, false positives, merge success, incident escape rate.
- Why: Для EvalsAgent.

## When To Use
- Измеряет качество работы агентов по acceptance pass rate, review bug yield, rework rate, false positives, merge success, incident escape rate.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Собирать gold tasks, PR outcome metrics, user feedback and comment reactions.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Собирать gold tasks, PR outcome metrics, user feedback and comment reactions.

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
