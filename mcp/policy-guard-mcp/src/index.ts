import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleToolPolicy {
  role_id: string;
  allowed_tools: string[];
  required_mcp_refs: string[];
  write_scopes: string[];
  denied_tools: string[];
  human_gated_tools: string[];
  notes: string;
}

interface ToolingPolicyFile {
  role_tool_policies: RoleToolPolicy[];
}

// ---------------------------------------------------------------------------
// Load policy YAML
// ---------------------------------------------------------------------------

const TOOLING_POLICY_PATH = process.env.TOOLING_POLICY_PATH;
if (!TOOLING_POLICY_PATH) {
  console.error("TOOLING_POLICY_PATH env var is required");
  process.exit(1);
}

const INTERNAL_API_BEARER_TOKEN = process.env.INTERNAL_API_BEARER_TOKEN;
if (!INTERNAL_API_BEARER_TOKEN) {
  console.error("INTERNAL_API_BEARER_TOKEN env var is required");
  process.exit(1);
}

const _CONTROL_API_BASE_URL =
  process.env.CONTROL_API_BASE_URL ?? "http://127.0.0.1:4000";

let policyData: ToolingPolicyFile;

try {
  const raw = readFileSync(TOOLING_POLICY_PATH, "utf-8");
  policyData = yaml.load(raw) as ToolingPolicyFile;

  if (
    !policyData ||
    !Array.isArray(policyData.role_tool_policies)
  ) {
    console.error(
      "Invalid policy file: expected top-level 'role_tool_policies' array"
    );
    process.exit(1);
  }
} catch (err) {
  console.error(`Failed to load policy file: ${err}`);
  process.exit(1);
}

// Build a lookup map for fast access
const policyByRole = new Map<string, RoleToolPolicy>();
for (const entry of policyData.role_tool_policies) {
  policyByRole.set(entry.role_id, entry);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRole(roleId: string): RoleToolPolicy | undefined {
  return policyByRole.get(roleId);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "policy-guard",
  version: "0.1.0",
});

// -- get_role_policy ---------------------------------------------------------

server.tool(
  "get_role_policy",
  "Return the full policy for a given role (allowed_tools, denied_tools, human_gated_tools, write_scopes, required_mcp_refs, notes)",
  { roleId: z.string().describe("The role identifier, e.g. 'orchestrator'") },
  async ({ roleId }) => {
    const role = findRole(roleId);
    if (!role) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Role '${roleId}' not found` }),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              role_id: role.role_id,
              allowed_tools: role.allowed_tools,
              denied_tools: role.denied_tools,
              human_gated_tools: role.human_gated_tools,
              write_scopes: role.write_scopes,
              required_mcp_refs: role.required_mcp_refs,
              notes: role.notes,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// -- list_denied_actions -----------------------------------------------------

server.tool(
  "list_denied_actions",
  "Return the denied_tools list for a given role",
  { roleId: z.string().describe("The role identifier") },
  async ({ roleId }) => {
    const role = findRole(roleId);
    if (!role) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Role '${roleId}' not found` }),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { role_id: role.role_id, denied_tools: role.denied_tools },
            null,
            2
          ),
        },
      ],
    };
  }
);

// -- list_human_gated_actions ------------------------------------------------

server.tool(
  "list_human_gated_actions",
  "Return the human_gated_tools list for a given role",
  { roleId: z.string().describe("The role identifier") },
  async ({ roleId }) => {
    const role = findRole(roleId);
    if (!role) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Role '${roleId}' not found` }),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              role_id: role.role_id,
              human_gated_tools: role.human_gated_tools,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// -- check_action_allowed ----------------------------------------------------

server.tool(
  "check_action_allowed",
  "Check whether a specific action is allowed for a role (must be in allowed_tools and not in denied_tools)",
  {
    roleId: z.string().describe("The role identifier"),
    action: z.string().describe("The action / tool name to check"),
  },
  async ({ roleId, action }) => {
    const role = findRole(roleId);
    if (!role) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Role '${roleId}' not found` }),
          },
        ],
        isError: true,
      };
    }

    const inAllowed = role.allowed_tools.includes(action);
    const inDenied = role.denied_tools.includes(action);
    const inHumanGated = role.human_gated_tools.includes(action);
    const allowed = inAllowed && !inDenied;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              role_id: role.role_id,
              action,
              allowed,
              in_allowed_tools: inAllowed,
              in_denied_tools: inDenied,
              human_gated: inHumanGated,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// -- list_all_roles ----------------------------------------------------------

server.tool(
  "list_all_roles",
  "Return the list of all role IDs defined in the policy",
  {},
  async () => {
    const roleIds = policyData.role_tool_policies.map((r) => r.role_id);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ roles: roleIds }, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting policy-guard MCP server:", err);
  process.exit(1);
});
