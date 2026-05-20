import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CONTROL_API_BASE_URL =
  process.env.CONTROL_API_BASE_URL ?? "http://127.0.0.1:4000";
const INTERNAL_API_BEARER_TOKEN = process.env.INTERNAL_API_BEARER_TOKEN;

if (!INTERNAL_API_BEARER_TOKEN) {
  console.error("INTERNAL_API_BEARER_TOKEN env var is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${CONTROL_API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${INTERNAL_API_BEARER_TOKEN}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${path} returned ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "integration-lab-mcp",
  version: "0.1.0",
});

// --- list_validation_runs ---------------------------------------------------

server.tool(
  "list_validation_runs",
  "List integration validation runs for a given issue",
  { issueId: z.string().describe("The issue identifier") },
  async ({ issueId }) => {
    const data = await apiRequest(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/validation-runs`
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// --- create_validation_run --------------------------------------------------

server.tool(
  "create_validation_run",
  "Create a new integration validation run",
  {
    issueId: z.string().describe("The issue identifier"),
    providerName: z.string().describe("Integration provider name"),
    validationType: z.string().describe("Type of validation to perform"),
    environment: z.string().describe("Target environment (e.g. sandbox, staging)"),
    summary: z.string().optional().describe("Optional human-readable summary"),
  },
  async ({ issueId, providerName, validationType, environment, summary }) => {
    const data = await apiRequest("POST", "/internal/integrations/validation-runs", {
      issueId,
      providerName,
      validationType,
      environment,
      ...(summary !== undefined && { summary }),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// --- list_webhooks -----------------------------------------------------------

server.tool(
  "list_webhooks",
  "List registered webhooks for a given issue",
  { issueId: z.string().describe("The issue identifier") },
  async ({ issueId }) => {
    const data = await apiRequest(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/webhooks`
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// --- register_webhook -------------------------------------------------------

server.tool(
  "register_webhook",
  "Register a new webhook for an integration",
  {
    issueId: z.string().describe("The issue identifier"),
    providerName: z.string().describe("Integration provider name"),
    environment: z.string().describe("Target environment"),
    callbackUrl: z.string().url().describe("URL that will receive webhook events"),
    eventTypes: z.array(z.string()).describe("List of event types to subscribe to"),
    signingSecretAlias: z
      .string()
      .optional()
      .describe("Alias for the signing secret used to verify payloads"),
  },
  async ({
    issueId,
    providerName,
    environment,
    callbackUrl,
    eventTypes,
    signingSecretAlias,
  }) => {
    const data = await apiRequest("POST", "/internal/integrations/webhooks", {
      issueId,
      providerName,
      environment,
      callbackUrl,
      eventTypes,
      ...(signingSecretAlias !== undefined && { signingSecretAlias }),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// --- check_sandbox_readiness ------------------------------------------------

server.tool(
  "check_sandbox_readiness",
  "Check whether a sandbox environment is ready for an integration provider (credentials resolved, webhooks registered, validation passing)",
  {
    issueId: z.string().describe("The issue identifier"),
    providerName: z.string().describe("Integration provider name to check"),
  },
  async ({ issueId, providerName }) => {
    // Fetch the integration summary for the issue
    const summary = (await apiRequest(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/summary`
    )) as {
      credentialSlots?: Array<{ resolved?: boolean; provider?: string }>;
      webhooks?: Array<{ provider?: string; registered?: boolean }>;
      validationRuns?: Array<{
        provider?: string;
        status?: string;
        result?: string;
      }>;
    };

    // Derive readiness signals
    const relevantCreds = (summary.credentialSlots ?? []).filter(
      (s) => s.provider === providerName
    );
    const credentialsResolved =
      relevantCreds.length > 0 && relevantCreds.every((s) => s.resolved);

    const relevantWebhooks = (summary.webhooks ?? []).filter(
      (w) => w.provider === providerName
    );
    const webhooksRegistered =
      relevantWebhooks.length > 0 && relevantWebhooks.every((w) => w.registered);

    const relevantRuns = (summary.validationRuns ?? []).filter(
      (r) => r.provider === providerName
    );
    const validationPassing =
      relevantRuns.length > 0 &&
      relevantRuns.every(
        (r) => r.status === "passed" || r.result === "pass"
      );

    const ready = credentialsResolved && webhooksRegistered && validationPassing;

    const report = {
      ready,
      credentialsResolved,
      webhooksRegistered,
      validationPassing,
      details: {
        credentialSlots: relevantCreds,
        webhooks: relevantWebhooks,
        validationRuns: relevantRuns,
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
    };
  }
);

// --- get_integration_summary ------------------------------------------------

server.tool(
  "get_integration_summary",
  "Get the full integration summary for an issue",
  { issueId: z.string().describe("The issue identifier") },
  async ({ issueId }) => {
    const data = await apiRequest(
      "GET",
      `/internal/issues/${encodeURIComponent(issueId)}/integrations/summary`
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
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
  console.error("Fatal error:", err);
  process.exit(1);
});
