# S23 — Performance & Scalability Reviewer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Ищет N+1, hot paths, bad queries, unnecessary rerenders, cache misses, concurrency bottlenecks.
- Why: Часто пропускается обычным code review.

## When To Use
- Ищет N+1, hot paths, bad queries, unnecessary rerenders, cache misses, concurrency bottlenecks.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Diff-aware + architecture-aware + telemetry-aware analysis.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Diff-aware + architecture-aware + telemetry-aware analysis.

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
