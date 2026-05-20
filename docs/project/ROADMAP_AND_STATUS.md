# Roadmap And Status

This file summarizes the implementation phases used by the project docs. It is
not a promise of production readiness; it is a public status map for contributors.

## Phase 1: Monorepo Bootstrap

Status: implemented baseline.

Scope:

- pnpm workspace;
- TypeScript packages;
- initial config and test structure;
- shared package boundaries.

## Phase 2: Config And Persistence Foundation

Status: implemented baseline.

Scope:

- Postgres schema and migration helpers;
- workflow config validation;
- agent config validation;
- standards config validation;
- release publishing scaffolds.

## Phase 3: Event Ingress

Status: implemented baseline.

Scope:

- webhook ingress shape;
- event normalization;
- inbox/outbox foundations;
- authenticated internal API boundaries.

## Phase 4: Repository Registry And Context Pipeline

Status: implemented baseline.

Scope:

- repository registry;
- context-pack metadata;
- knowledge/context reads;
- source and artifact references.

## Phase 5: Issue Lifecycle Workflow

Status: partially implemented.

Scope:

- lifecycle orchestration contracts;
- Linear state mapping;
- workflow transition rules;
- runtime policies for role execution.

Remaining work:

- deeper production verification;
- failure-mode hardening;
- full live Linear end-to-end closure.

## Phase 6: Runner Fabric And Provider Adapters

Status: implemented scaffolding and deterministic fake-runner paths.

Scope:

- runner-host manifests;
- lease claims;
- heartbeat/completion protocol;
- provider adapter contracts;
- shared MCP binding model;
- fake provider execution;
- managed skill sync model.

Remaining work:

- production runner deployment hardening;
- real provider host rollout;
- operational dashboards and alerts;
- live multi-provider failover validation.

## Phase 7: First End-To-End Build And Review

Status: architecture and readiness model exist; implementation remains
experimental.

Scope:

- frozen context consumption;
- review-as-runtime execution;
- reviewed artifact publication;
- reference-repo verification.

Remaining work:

- dedicated live Phase 7 verification gate;
- review outcome write-back;
- stable public demo/reference scenario.

## Open-Source Release Track

Status: source-only public candidate prepared.

The public release track focuses on:

- sanitized docs and examples;
- placeholder-only env files;
- no generated or dependency artifacts;
- no hidden local agent metadata;
- no real credentials, webhook URLs, vault paths, or private workspace IDs.

Before the first public push, rotate any credentials that existed in local env
files and enable GitHub security features for the public repository.
