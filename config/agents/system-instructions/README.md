# System Instructions

This directory contains role-specific system instruction documents for each agent in the AI Dev Team.

## Position in the Instruction Hierarchy

System instructions live at **Layer 4 (Agent Runtime)** in the five-layer instruction hierarchy:

1. **System** (`config/agent-standards/`) — immutable core policy, protocols, checklists
2. **Project** (`config/agent-standards/project-profiles/`) — project-specific KB, escalation owners, repo mappings
3. **Repository** (`AGENTS.md`, per-directory `AGENTS.md`) — repo-specific build/test/style rules
4. **Agent Runtime** (`config/agents/system-instructions/`) — **this directory** — role-specific behavior, routing tables, templates
5. **Provider** (`config/agents/provider-overlays/`) — transport-only overlays for Codex/Claude

Authoritative layering policy: `config/agent-standards/manifests/layering-policy.yaml`

## Rules

- System instructions **must not** relax or override Layers 1-3.
- System instructions **may** add role-specific detail, tighten constraints, and define operational behavior.
- Each file must include frontmatter with `role_id`, `version`, and `standards_bundle_ref`.
- Files are versioned alongside the agent library and included in published releases.
- The `config/agents/manifests/library.yaml` field `system_instructions_dir` points here.

## Naming Convention

`{role_id}_system_instructions.md`

Example: `orchestrator_system_instructions.md`, `intake_agent_system_instructions.md`

## Update Procedure

1. Edit the working-tree file in this directory.
2. Validate against source configs (transition_rules, runtime_role_contracts, tooling-policy, etc.).
3. Bump `config/agents/manifests/library.yaml` version if publishing a new release.
4. Publish via `corepack pnpm db:publish-agent-release`.
