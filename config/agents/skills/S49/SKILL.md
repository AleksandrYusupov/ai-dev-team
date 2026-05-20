# S49 — Provider Capability & Runner Network Fit Validator

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Validates that the runner host and network environment are compatible with the target provider: outbound connectivity, IP allowlisting, required SDK/runtime availability, sandbox environment existence, and network policy alignment.
- Why: An integration can have perfect auth and clean code but still fail at runtime if the runner cannot reach the provider or lacks the required runtime. This skill catches environment mismatches before code is written.

## When To Use
- When IntegrationAgent (A21) needs to confirm that the runner environment supports the planned integration before moving to Ready for Build.
- When SecurityAgent (A13) reviews network policy and needs a structured environment fit report.
- When a new provider is being onboarded and its connectivity and runtime requirements have not been validated against the runner.
- Do NOT use for validating auth configuration or credential readiness — use S46, S47, and S48 for those concerns.

## Inputs
- S46 classification record: `provider_name`, `integration_kind`, `auth_scheme`.
- S47 integration_brief: `endpoints`, `rate_limits`, `sandbox_state`.
- Runner environment profile: OS, runtime versions, installed SDKs, network policies, egress rules.
- Provider connectivity requirements: base URLs, IP ranges for allowlisting, required TLS versions.

## Steps

1. **Verify outbound connectivity** — check that the runner can reach provider endpoints:
   - Resolve provider base URLs and confirm DNS resolution is possible from the runner.
   - Verify that egress firewall rules allow HTTPS (or required protocol) to provider IP ranges.
   - If the provider requires IP allowlisting on their side, confirm the runner's egress IPs are registered.
   - Check TLS version requirements (e.g., TLS 1.2 minimum) against runner capabilities.

2. **Validate required runtimes and SDKs** — confirm the runner has what the integration needs:
   - If `integration_kind` is `sdk`, verify the vendor SDK is installable and the required runtime version is available.
   - Check language runtime versions (Node.js, Python, Go, etc.) against vendor SDK requirements.
   - Verify that system-level dependencies (OpenSSL version, native libraries) are present.
   - For `mtls` auth, confirm the runner's certificate infrastructure supports client certificates.

3. **Check sandbox environment availability** — validate test infrastructure:
   - Confirm a sandbox or staging environment exists for the provider (from S47 `sandbox_state`).
   - Verify the runner can reach sandbox endpoints (which may differ from production).
   - Check that sandbox credentials/slots are provisioned separately from production.
   - Confirm rate limits in sandbox are sufficient for integration testing.

4. **Assess network policy alignment** — review security constraints:
   - Verify that the integration does not violate existing network segmentation policies.
   - For `webhook` integrations, confirm the runner accepts inbound traffic from provider IP ranges.
   - Check that required ports are open in both directions as needed.
   - Validate that proxy or VPN requirements (if any) are met.

5. **Compile fit report** — produce the structured validation result:
   - `provider_name`, `runner_id`, `validation_timestamp`.
   - `connectivity_status`: pass/fail with details per endpoint.
   - `runtime_status`: pass/fail with missing dependencies listed.
   - `sandbox_status`: available/unavailable/untested.
   - `network_policy_status`: compliant/non-compliant with specific violations listed.
   - `overall_fit`: `ready` / `blocked` / `needs_remediation`.
   - `remediation_steps`: actionable list if any check failed.

6. **Emit outputs** — deliver the fit report to IntegrationAgent and attach a summary to the Linear issue. If `overall_fit` is `blocked`, tag the issue with `needs:runner_remediation`.

## Stop Conditions
- **Done** when all four validation checks (connectivity, runtime, sandbox, network policy) have completed and the fit report is assembled.
- **Blocked** when the runner cannot reach provider endpoints and no remediation path is available.
- **Needs remediation** when some checks fail but the remediation steps are clear and actionable.

## Escalation Rules
- Escalate when network policy changes are required that exceed IntegrationAgent's authority (e.g., firewall rule changes, VPN configuration).
- Escalate when the runner lacks a required runtime and no install path exists within the current environment.
- Escalate when the provider requires IP allowlisting and the runner's egress IPs are unknown or dynamic.
- Do NOT escalate for routine validation passes — emit the fit report and move on.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- Do not perform actual network calls to provider endpoints using real credentials — validation uses metadata, DNS checks, and policy inspection only.
- Do not skip sandbox validation even if production connectivity passes — sandbox and production environments often differ.
- Do not treat a passing connectivity check as a complete validation — all four checks must pass.
- Do not embed raw credentials or tokens in the fit report.

## Denied Actions
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
- Do not use real credentials to test connectivity — validation is metadata-plane only.
