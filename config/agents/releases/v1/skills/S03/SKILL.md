# S03 — Clarifying Questions Composer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- Why: Ключевой skill для Needs Input.

## When To Use
- Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Формат: what_missing, why_needed, options, preferred_answer_shape, blocking_vs_optional.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Формат: what_missing, why_needed, options, preferred_answer_shape, blocking_vs_optional.

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
