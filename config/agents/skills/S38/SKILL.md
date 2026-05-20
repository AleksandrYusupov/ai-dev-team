# S38 — Repository Registry Sync

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Синхронизирует backend registry ↔ Linear projects/labels/links ↔ repo metadata.
- Why: Критично для маршрутизации и источника истины.

## When To Use
- Синхронизирует backend registry ↔ Linear projects/labels/links ↔ repo metadata.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Bi-directional but registry is canonical. Detect drift and propose fixes.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Bi-directional but registry is canonical. Detect drift and propose fixes.

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
