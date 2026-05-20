# S08 — Verification Path Designer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Строит конкретный technical proof path: commands, checks, smoke, manual steps, expected outputs.
- Why: Связывает spec и test.

## When To Use
- Строит конкретный technical proof path: commands, checks, smoke, manual steps, expected outputs.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Учитывать repo commands, environment constraints, fastest signal path.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Учитывать repo commands, environment constraints, fastest signal path.

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
