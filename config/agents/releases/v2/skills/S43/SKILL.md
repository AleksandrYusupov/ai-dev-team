# S43 — Stakeholder Status Reporter

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Пишет summaries для founders/PMs/eng leads: что движется, где риск, что заблокировано, что требует решения.
- Why: Основа ReporterAgent.

## When To Use
- Пишет summaries для founders/PMs/eng leads: что движется, где риск, что заблокировано, что требует решения.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Audience-aware tone; concise; always include next decision point.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Audience-aware tone; concise; always include next decision point.

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
