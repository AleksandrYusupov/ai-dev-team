# S48 — Credential Prerequisite Handshake Manager

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Формирует structured Needs Input handoff для secret upload, redirect URI registration, scope approval, OAuth consent completion и webhook registration; никогда не просит raw credential paste.
- Why: Самая частая точка поломки в интеграциях — не код, а плохой handshake между системой и человеком.

## When To Use
- Формирует structured Needs Input handoff для secret upload, redirect URI registration, scope approval, OAuth consent completion и webhook registration; никогда не просит raw credential paste.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Выход должен содержать what_missing, why_needed, exact console action, accepted answer shape, blocking flag, secure upload path и post-response resume rule. Любой unresolved needs:* prerequisite обязан удерживать issue вне Ready for Build.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Выход должен содержать what_missing, why_needed, exact console action, accepted answer shape, blocking flag, secure upload path и post-response resume rule. Любой unresolved needs:* prerequisite обязан удерживать issue вне Ready for Build.

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
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
