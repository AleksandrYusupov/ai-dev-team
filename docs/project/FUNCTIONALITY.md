# Functionality Guide

This guide describes the major functional surfaces in the repository and how
they fit together.

## Workflow Configuration

Workflow behavior is file-backed under `config/workflow`.

Important concepts:

- statuses and transitions define issue lifecycle shape;
- triggers map external events or human actions into workflow movement;
- role execution policies choose providers, capabilities, and runtime rules;
- runtime role contracts define which roles can execute which run kinds;
- Linear sync config maps internal state back to Linear-facing status.

Validation entrypoints:

```bash
corepack pnpm db:validate-workflow-config
corepack pnpm test
```

## Agent Library

Agent role, prompt, skill, and release truth lives under `config/agents`.

The library includes:

- role charters for orchestration, planning, build, review, testing, security,
  release, reporting, integration, monitoring, and dependency work;
- prompt families and provider overlays;
- skill definitions and skill packs;
- routing rules that select additional skill packs for task types;
- immutable release snapshots under `config/agents/releases`.

Validation entrypoints:

```bash
corepack pnpm db:validate-agent-config
corepack pnpm db:validate-agent-release
```

## Standards And Instruction Layers

Repository-level agent standards live under `config/agent-standards` and
`AGENTS.md`.

The intended hierarchy is:

```text
system > project > repository > agent/runtime > provider
```

Lower layers may add constraints, but they must not relax higher-priority rules.
Provider overlays should stay thin and provider-specific.

Validation entrypoint:

```bash
corepack pnpm db:validate-agent-standards
```

## Control API

`apps/control-api` is the main HTTP service. It includes:

- webhook ingress;
- internal inspection routes;
- knowledge/context reads;
- runner-host read/write protocol routes;
- authenticated runner manifest, lease, heartbeat, artifact, and completion
  surfaces.

The service expects secrets and tokens through environment variables or a
deployment secret manager. Public docs only show placeholders.

## Workflow Worker

`apps/workflow-worker` owns Temporal-backed execution loops and durable event
handling:

- inbox processing;
- outbox execution;
- issue lifecycle orchestration;
- Linear state sync;
- integration-sensitive gates;
- test/live harnesses for later phases.

Temporal is treated as workflow execution truth, while Postgres remains durable
coordination and metadata truth.

## Runner Host

`apps/runner-host` is a trusted local process that claims work and executes
provider attempts.

Responsibilities:

- publish capability manifests;
- claim runner leases;
- prepare isolated worktrees;
- acquire shared MCP bindings;
- launch provider adapters;
- stage artifacts and patches;
- report heartbeats and terminal completion;
- run fake-provider smoke paths for deterministic local testing.

Real provider credentials and local agent auth files are never committed.

## Repository Registry And Context Packs

The repository registry and context pipeline track which repositories and
knowledge sources are available for task execution. Context packs are designed
to freeze the relevant task context for a workflow attempt so agents do not rely
on mutable ambient state.

Sensitive values must be redacted before context is persisted or handed to a
runner.

## Secrets/Auth Plane

The Secrets/Auth plane is metadata-only in this repository. It can track aliases,
scopes, consent state, webhook signing state, callback metadata, and rotation
lifecycle, but raw secret material must live outside the repository.

Do not paste secrets into:

- Linear issues or comments;
- Obsidian notes;
- `.env.example`;
- Git-tracked docs;
- context-pack artifacts;
- changelogs.

See [Security](../../SECURITY.md) and [Configuration](../CONFIGURATION.md).
