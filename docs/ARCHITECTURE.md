# Architecture

AI Dev Team separates human workflow, durable orchestration, code truth, runtime execution, and credential handling into explicit boundaries.

For a more contributor-oriented documentation map, see
[project documentation](project/README.md).

## Source-Of-Truth Split

- Linear is the operator surface for intent, issue status, comments, ownership, and human handoffs.
- Temporal is the workflow execution backbone for long-lived issue orchestration and command sequencing.
- GitHub is the source of truth for code, pull requests, checks, branches, and release gates.
- Postgres stores durable runtime truth: workflow config, issue state, raw inbox rows, context-pack cache, runner leases, runner attempts, prompt/skill runtime mirrors, and integration metadata.
- Obsidian remains the private long-lived knowledge base. Public repo docs are sanitized runtime and contributor documentation, not raw vault export.
- Trusted runner hosts execute provider sessions locally and report back through the runner-host protocol.
- Secrets/Auth plane stores metadata only. Raw secret values, OAuth codes, access tokens, refresh tokens, and webhook signing material stay in a secret manager or broker.

## Main Components

### Control API

`apps/control-api` is a Fastify service. It owns:

- webhook ingress routes for supported providers;
- internal read/inspection routes;
- authenticated runner-host routes;
- knowledge/context read surfaces;
- sanitized OAuth callback capture.

It must not directly bypass lifecycle rules or mutate business status outside documented command paths.

### Workflow Worker

`apps/workflow-worker` owns Temporal workflow execution, inbox processing, outbox command execution, transition validation usage, and lifecycle orchestration. Workflow code coordinates durable steps but keeps nondeterministic I/O inside activities and application services.

### Runner Host

`apps/runner-host` is a trusted local process. It publishes capabilities, long-polls for leases, heartbeats attempts, manages provider adapters, stages artifacts, and uses a shared MCP pool. Runner hosts are trusted execution surfaces, not public APIs.

### Database Package

`packages/db` owns migrations, schema helpers, config validation/publish CLIs, runner lease helpers, workflow runtime helpers, and agent-library validation. Postgres remains the durable state boundary.

### Shared Contracts

`packages/shared` owns versioned DTOs and enum contracts used across apps and packages. Provider-specific CLI details should stay inside provider adapters, not shared workflow rules.

### Prompt And Skill Library

`config/agents` contains role charters, prompt families, skill packs, skills, provider overlays, and immutable release snapshots. Published snapshots are used for runtime pinning so a run can be audited against the exact prompt/skill bundle that was selected.

## Secrets/Auth Plane

Integration support is designed around metadata-only persistence:

- allowed in Postgres: aliases, provider/environment bindings, scopes, redirect URIs, consent state, token-handle metadata, webhook registration metadata, validation status, and rotation/revoke metadata;
- forbidden in Postgres/docs/prompts/artifacts/context packs: raw API keys, raw OAuth codes, access tokens, refresh tokens, passwords, browser session dumps, and webhook signing secrets.

Credential use remains human-gated and broker-backed. The repository does not contain live credentials or workspace-specific webhook configuration.

## Knowledge And Context Packs

The knowledge pipeline is summary-first. Context packs may include issue contracts, bounded comments, sanitized note summaries, repo guidance excerpts, budgets, and source trace metadata. They must not include raw webhook payloads, full comment logs, `.env` contents, raw credentials, or full private vault notes by default.

## Runner And MCP Boundaries

Runner hosts publish capability manifests. MCP reuse is explicit:

- `host` scope can be shared across executions on a trusted host;
- `repo` scope can be reused only for the same repo identity;
- `exclusive` scope is per execution session.

The control plane routes based on persisted capability truth. It does not infer runner capabilities by shell probing.

## Non-Goals In This Public Release

- No turnkey production deployment.
- No committed provider credentials.
- No automatic production credential onboarding.
- No guarantee that local provider CLIs are installed or authenticated.
- No raw private Obsidian vault dump. The repository includes a sanitized public
  project documentation export under [docs/project](project/README.md).
