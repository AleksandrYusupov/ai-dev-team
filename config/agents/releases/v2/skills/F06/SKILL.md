# F06 — Structured Summary Writer

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- Why: Агентная система умирает, если люди не понимают, что именно уже сделано и что осталось.

## When To Use
- Пишет короткие, high-signal сводки для Linear comments, PR descriptions, release notes, postmortems и status updates.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Форматы: work summary, blocker summary, question summary, PR summary, release summary, monitoring summary. Всегда указывать facts / unknowns / asks / links.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Форматы: work summary, blocker summary, question summary, PR summary, release summary, monitoring summary. Всегда указывать facts / unknowns / asks / links.

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
