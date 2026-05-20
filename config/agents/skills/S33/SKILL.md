# S33 — Logs/Traces/Metrics Triage

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `human_gate_required`
- Description: Переходит от alert/trace/log anomaly к suspect component, suspect change, repro hints и next actions.
- Why: Основа MonitoringAgent.

## When To Use
- Переходит от alert/trace/log anomaly к suspect component, suspect change, repro hints и next actions.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужна корреляция telemetry↔deploy↔commit↔issue. Поддержать OTel semantics.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужна корреляция telemetry↔deploy↔commit↔issue. Поддержать OTel semantics.

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
