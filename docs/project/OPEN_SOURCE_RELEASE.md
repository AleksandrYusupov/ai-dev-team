# Open Source Release

This document captures the public release model for the repository.

## Publish Scope

The intended public scope is a sanitized full source repository:

- TypeScript source;
- workflow config;
- agent config and release snapshots;
- public docs;
- test fixtures and deterministic fake-runner paths;
- placeholder-only env example.

The public scope excludes:

- `.env`, `.env.local`, and local override env files;
- generated `dist` output;
- dependency folders;
- hidden local agent state;
- local runner worktrees and artifacts;
- real credentials, webhook URLs, OAuth secrets, bearer tokens, or private keys;
- private vault paths or private vendor workspace identifiers.

## Release Candidate Paths

The prepared local release workflow uses two copies:

- `/private/tmp/ai-dev-team-public` for install/build/test verification;
- `/private/tmp/ai-dev-team-public-source` as the source-only publish candidate.

Create the first public GitHub repository from the source-only publish candidate,
not from the working folder.

## Required Pre-Push Checks

Run these checks from a clean public candidate before first push:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

When local infrastructure is available, also run:

```bash
corepack pnpm infra:up
corepack pnpm test:integration
```

Run local scans for:

- `.env` and local env override files;
- private keys and certificates;
- generated and dependency folders;
- local user paths and vault paths;
- GitHub, Linear, OpenAI-style, AWS-style, JWT, private-key, and webhook-secret
  patterns.

## Credential Rotation

Before the first public push, rotate credentials that existed in local env files
or any publish candidate:

- Linear API token;
- Linear webhook secret;
- GitHub webhook secret;
- runner bearer tokens;
- internal API bearer token;
- OAuth client secrets;
- provider credentials;
- deployment secrets.

Create public repository secrets only through GitHub Actions secrets or the
deployment secret manager. Never commit real values.

## GitHub Settings

After creating the public repository, enable or confirm:

- secret scanning;
- push protection;
- Dependabot alerts and updates;
- restrictive GitHub Actions permissions;
- branch protection;
- required CI checks;
- security policy visibility.
