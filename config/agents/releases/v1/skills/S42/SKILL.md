# S42 — DORA & SPACE Metrics Interpreter

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Считает и интерпретирует delivery + developer experience metrics: deployment frequency, lead time, change failure rate, MTTR, plus SPACE dimensions.
- Why: Нужен для управления отделом, а не только отдельными задачами.

## When To Use
- Считает и интерпретирует delivery + developer experience metrics: deployment frequency, lead time, change failure rate, MTTR, plus SPACE dimensions.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Не сводить всё к одной цифре. Разделять outcome vs activity metrics.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Не сводить всё к одной цифре. Разделять outcome vs activity metrics.

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
