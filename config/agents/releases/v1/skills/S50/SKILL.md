# S50 — OAuth Consent & Callback Sanitizer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Обрабатывает OAuth callback/onboarding flow безопасно: сохраняет только sanitized callback facts, проверяет redirect URI and scope readiness, держит browser-based consent human-in-the-loop.
- Why: OAuth automation ломается и по безопасности, и по UX, если callback, consent и token-exchange boundaries размыты.

## When To Use
- Обрабатывает OAuth callback/onboarding flow безопасно: сохраняет только sanitized callback facts, проверяет redirect URI and scope readiness, держит browser-based consent human-in-the-loop.
- TODO: tighten the selection boundary for runtime use.

## Inputs
- Source build spec snapshot: Для MVP: фиксировать provider, consent state, timestamp, requester, safe identifiers и next step; не сохранять raw authorization code. Для последующих фаз: подготовить boundary под broker-driven token exchange/refresh/revoke. Поддерживать PKCE-aware and state-aware reasoning.
- TODO: normalize the final input contract.

## Steps
- TODO: replace this placeholder with deterministic execution steps.
- Seed source snapshot: Для MVP: фиксировать provider, consent state, timestamp, requester, safe identifiers и next step; не сохранять raw authorization code. Для последующих фаз: подготовить boundary под broker-driven token exchange/refresh/revoke. Поддерживать PKCE-aware and state-aware reasoning.

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
