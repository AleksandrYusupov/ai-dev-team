# Project Overview

AI Dev Team is an experimental control plane for software delivery work run by
agentic workers. It coordinates Linear, GitHub, Temporal, Postgres, local runner
hosts, MCP servers, and versioned prompt/skill bundles.

The project is intentionally source-only for the first public release. It is
published for inspection, experimentation, and collaboration, not as a turnkey
production deployment with managed credentials.

## Purpose

The system models a software delivery team as a set of explicit control-plane
components:

- Linear is the human-facing operator surface.
- Temporal is the workflow execution backbone.
- GitHub is source code, pull request, and CI truth.
- Postgres is durable system state and metadata truth.
- Trusted runner hosts execute provider sessions and stage artifacts.
- Obsidian remains the private long-term architecture knowledge base.
- The public repository contains sanitized docs and executable config truth.

## Primary Boundaries

- `apps/control-api` exposes webhook ingress, internal inspection routes,
  runner-host protocol routes, and knowledge/context reads.
- `apps/workflow-worker` owns Temporal worker execution, inbox processing,
  outbox execution, and lifecycle orchestration.
- `apps/runner-host` owns local provider execution, shared MCP lifecycle,
  worktrees, artifacts, provider adapters, and fake-runner smoke paths.
- `packages/db` owns migrations, schema, config publishing, runtime helpers, and
  validation CLIs.
- `packages/config` owns environment parsing and runtime configuration.
- `packages/shared` owns shared DTOs, enums, and cross-package contracts.
- `config/workflow` is file-backed workflow/status/routing truth.
- `config/agents` is file-backed agent role, prompt, skill, and release truth.
- `config/agent-standards` is file-backed standards and instruction-layer truth.

## Source Of Truth Model

The project separates human-facing, workflow, code, and credential truth:

- Linear issue state is operator-facing and should stay concise.
- Temporal workflow state is the execution timeline.
- GitHub owns code review, branches, pull requests, and CI results.
- Postgres stores durable coordination state, config releases, and auth metadata.
- Secret values never belong in Linear, Obsidian, source control, or generated
  context packs.

## Current Maturity

The repository includes the core monorepo packages, workflow configuration,
agent library snapshots, runner-host protocol surfaces, fake-runner smoke paths,
and public setup docs.

The following areas are still intentionally experimental:

- full production credential automation;
- live provider execution across heterogeneous hosts;
- production deployment packaging;
- complete end-to-end Linear-to-GitHub automation;
- hosted secret broker and OAuth broker implementations.

For phase-level status, see [Roadmap And Status](ROADMAP_AND_STATUS.md).
