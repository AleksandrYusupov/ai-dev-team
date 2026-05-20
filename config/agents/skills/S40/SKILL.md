# S40 — Tech Debt & Stale Code Detector

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Находит feature flags to remove, dead code, stale docs, deprecated APIs, low-value toil automation targets.
- Why: Даёт отделу не только доставку, но и постоянное оздоровление системы.

## When To Use
- Находит feature flags to remove, dead code, stale docs, deprecated APIs, low-value toil automation targets.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Регулярные scans + issue creation suggestions ranked by impact.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Регулярные scans + issue creation suggestions ranked by impact.

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
