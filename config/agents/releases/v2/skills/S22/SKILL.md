# S22 — Semantic PR Reviewer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Проверяет diff семантически: requirements match, hidden regressions, race conditions, broken invariants, consistency, maintainability.
- Why: Ключевой skill ReviewAgent.

## When To Use
- Проверяет diff семантически: requirements match, hidden regressions, race conditions, broken invariants, consistency, maintainability.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужен high-signal output: issue, severity, evidence, suggested fix, risk of false positive.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужен high-signal output: issue, severity, evidence, suggested fix, risk of false positive.

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
