# S01 — Triage Classifier

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- Why: Основа IntakeAgent.

## When To Use
- Классифицирует issue по type/risk/source/mode/area и определяет, нужен ли spec, input или можно идти дальше.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Модель multilabel classification + confidence + rationale + required next status.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Модель multilabel classification + confidence + rationale + required next status.

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
