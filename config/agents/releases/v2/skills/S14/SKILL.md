# S14 — Backend Implementation Pack

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Глубокие правила backend-кодинга: API contracts, services, validation, logging, idempotency, error handling, telemetry, feature flags.
- Why: Основной domain skill для BackendBuildAgent.

## When To Use
- Глубокие правила backend-кодинга: API contracts, services, validation, logging, idempotency, error handling, telemetry, feature flags.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Нужно адаптировать под стек каждого repo: language, framework, lint/test/build, package manager, persistence layer.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Нужно адаптировать под стек каждого repo: language, framework, lint/test/build, package manager, persistence layer.

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
