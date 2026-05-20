import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONTROL_API_BASE_URL =
  process.env.CONTROL_API_BASE_URL ?? "http://127.0.0.1:4000";

const INTERNAL_API_BEARER_TOKEN = process.env.INTERNAL_API_BEARER_TOKEN;
if (!INTERNAL_API_BEARER_TOKEN) {
  console.error(
    "FATAL: INTERNAL_API_BEARER_TOKEN environment variable is required",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function callControlApi(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${CONTROL_API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${INTERNAL_API_BEARER_TOKEN}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Control API ${method} ${path} returned ${res.status}: ${text}`,
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "secret-broker-mcp",
  version: "0.1.0",
});

// --- list_credential_slots ---------------------------------------------------

server.tool(
  "list_credential_slots",
  "List all credential slots associated with a given issue. Returns metadata only — no raw secrets.",
  { issueId: z.string().describe("The issue ID to list credential slots for") },
  async ({ issueId }) => {
    const response = await callControlApi(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/credential-slots`,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

// --- get_credential_slot -----------------------------------------------------

server.tool(
  "get_credential_slot",
  "Get a single credential slot by ID for a given issue. Returns metadata only — no raw secrets.",
  {
    issueId: z.string().describe("The issue ID"),
    slotId: z.string().describe("The credential slot ID to retrieve"),
  },
  async ({ issueId, slotId }) => {
    const response = (await callControlApi(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/credential-slots`,
    )) as unknown[];

    const slots = Array.isArray(response) ? response : [];
    const slot = slots.find(
      (s: any) => s.id === slotId || s.slotId === slotId,
    );

    if (!slot) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: "not_found", message: `Slot ${slotId} not found` },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(slot, null, 2) }],
    };
  },
);

// --- request_credential ------------------------------------------------------

server.tool(
  "request_credential",
  "Request provisioning of a new credential slot. The control-api will handle actual secret storage; this tool only creates the metadata record.",
  {
    issueId: z.string().describe("The issue ID"),
    providerName: z
      .string()
      .describe("Name of the credential provider (e.g. github, aws, stripe)"),
    credentialKey: z
      .string()
      .describe("Logical key for the credential (e.g. GITHUB_TOKEN)"),
    authScheme: z
      .string()
      .describe("Authentication scheme (e.g. bearer, basic, oauth2)"),
    environment: z
      .string()
      .describe("Target environment (e.g. development, staging, production)"),
    secretAlias: z
      .string()
      .describe("Alias under which the secret will be referenced"),
    ownerActorType: z
      .string()
      .describe("Type of the owning actor (e.g. agent, user, service)"),
    ownerActorId: z.string().describe("ID of the owning actor"),
    scopes: z
      .array(z.string())
      .describe("List of permission scopes requested"),
  },
  async ({
    issueId,
    providerName,
    credentialKey,
    authScheme,
    environment,
    secretAlias,
    ownerActorType,
    ownerActorId,
    scopes,
  }) => {
    const response = await callControlApi(
      "POST",
      `/internal/integrations/credential-slots`,
      {
        issueId,
        providerName,
        credentialKey,
        authScheme,
        environment,
        secretAlias,
        ownerActorType,
        ownerActorId,
        scopes,
      },
    );
    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

// --- check_credential_status -------------------------------------------------

server.tool(
  "check_credential_status",
  "Check the current provisioning status of a credential slot. Returns status and any error information.",
  {
    issueId: z.string().describe("The issue ID"),
    slotId: z.string().describe("The credential slot ID to check"),
  },
  async ({ issueId, slotId }) => {
    const response = (await callControlApi(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/credential-slots`,
    )) as unknown[];

    const slots = Array.isArray(response) ? response : [];
    const slot = slots.find(
      (s: any) => s.id === slotId || s.slotId === slotId,
    ) as Record<string, unknown> | undefined;

    if (!slot) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: "not_found", message: `Slot ${slotId} not found` },
              null,
              2,
            ),
          },
        ],
      };
    }

    const statusInfo = {
      slotId,
      status: slot.status ?? "unknown",
      lastError: slot.lastError ?? null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(statusInfo, null, 2) }],
    };
  },
);

// --- update_credential_status ------------------------------------------------

server.tool(
  "update_credential_status",
  "Update the status of a credential slot (e.g. mark as provisioned, failed, revoked).",
  {
    slotId: z.string().describe("The credential slot ID to update"),
    status: z
      .string()
      .describe(
        "New status value (e.g. pending, provisioned, failed, revoked)",
      ),
    lastError: z
      .string()
      .optional()
      .describe("Optional error message if the status is failed"),
  },
  async ({ slotId, status, lastError }) => {
    const body: Record<string, unknown> = { status };
    if (lastError !== undefined) {
      body.lastError = lastError;
    }

    const response = await callControlApi(
      "PATCH",
      `/internal/integrations/credential-slots/${encodeURIComponent(slotId)}/status`,
      body,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

// --- list_token_handles ------------------------------------------------------

server.tool(
  "list_token_handles",
  "List token handles for a given issue. Returns handle metadata — never raw token values.",
  { issueId: z.string().describe("The issue ID to list token handles for") },
  async ({ issueId }) => {
    const response = await callControlApi(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/token-handles`,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("secret-broker-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start secret-broker-mcp:", err);
  process.exit(1);
});
