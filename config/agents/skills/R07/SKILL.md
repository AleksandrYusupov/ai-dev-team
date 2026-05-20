# R07 — Anthropic doc-coauthoring

## Summary
- Category: `reusable`
- Availability: `downloadable`
- Kind: `reusable`
- Reference-only default: `true`
- Sensitivity class: `reference_only`
- Description: Официальный пример скилла для совместного написания документов.
- Why: Хорошая база для DocsAgent, SpecAgent, ADR/PLAN generation.

## When To Use
- Официальный пример скилла для совместного написания документов.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: TBD
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: TBD

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
- Do not enable this skill as a runtime dependency until an explicit import decision is approved.
