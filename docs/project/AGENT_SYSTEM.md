# Agent System

AI Dev Team models a delivery organization as explicit agent roles backed by
versioned prompts, skill packs, and runtime policy.

## Role Model

The canonical role set is stored in `config/agents/role-charters` and mirrored
in release snapshots under `config/agents/releases`.

Role families include:

- orchestration and reporting;
- intake, planning, specification, architecture, and context curation;
- backend, frontend, infrastructure, data migration, and integration build work;
- review, testing, security, release, monitoring, dependency, and eval work.

Only the orchestrator is intended to be the primary visible Linear actor. Other
roles are internal execution roles unless a future policy explicitly exposes
them.

## Prompt Families

Prompt families live under `config/agents/prompt-families`.

They provide role-independent guidance for areas such as:

- global baseline behavior;
- planning;
- build work;
- review;
- operations;
- platform;
- integration;
- reporting.

Provider overlays under `config/agents/provider-overlays` should only contain
provider-specific adaptation, not core project policy.

## Skill Packs

Skill packs live under `config/agents/skill-packs` and group reusable skill
references for role and task contexts.

Routing rules can add skill packs based on task type, risk, integration
sensitivity, or execution requirements. Integration-sensitive skills must not
receive raw credentials directly.

## Runtime Policies

Runtime execution policy combines:

- role execution policies from `config/workflow/role_execution_policies.yaml`;
- runtime role contracts from `config/workflow/runtime_role_contracts.yaml`;
- provider overlays from `config/agents/provider-overlays`;
- runner-host capability manifests;
- installed managed skill bundles.

This keeps the same role charter portable across different local runner hosts
while preserving auditability.

## Runner Host Responsibilities

Runner hosts are trusted execution surfaces. They should:

- publish only capabilities that actually exist locally;
- claim only work they can execute;
- isolate worktrees and artifacts;
- reuse MCP bindings according to explicit sharing scope;
- preserve attempt-level audit state;
- report terminal status durably;
- avoid exposing local auth files or raw credentials through artifacts.

## MCP Sharing Model

MCP server bindings use explicit sharing scopes:

- `host`: shared across the host where safe;
- `repo`: shared per repository;
- `exclusive`: one binding per execution session.

The default is conservative. Any MCP server without proven multiplex safety
should be treated as `exclusive`.

## Release Model

Agent library releases are immutable snapshots under `config/agents/releases`.
The working library can evolve, but production rollout should pin a release ID
and fingerprint so agents execute against stable prompt/skill inputs.

Validation entrypoints:

```bash
corepack pnpm db:validate-agent-config
corepack pnpm db:validate-agent-release
corepack pnpm db:validate-agent-standards
```
