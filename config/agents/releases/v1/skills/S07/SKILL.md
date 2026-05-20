# S07 — Acceptance Criteria Engineer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Преобразует vague request в тестируемые acceptance criteria и done_when.
- Why: Без этого build/test дрейфуют.

## When To Use
- Преобразует vague request в тестируемые acceptance criteria и done_when.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Разделять user-visible AC и engineering done_when. Выдавать measurable checks.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Разделять user-visible AC и engineering done_when. Выдавать measurable checks.

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
