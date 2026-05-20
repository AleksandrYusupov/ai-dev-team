# S35 — Incident Timeline & Postmortem Drafter

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Собирает timeline, impact, root-cause hypotheses, contributing factors, follow-up actions.
- Why: Нужен MonitoringAgent и EvalsAgent.

## When To Use
- Собирает timeline, impact, root-cause hypotheses, contributing factors, follow-up actions.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Без blame, с action items и link to preventing controls.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Без blame, с action items и link to preventing controls.

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
- Do not execute protected, irreversible, or approval-bound actions without the declared human gate.
