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

function apiHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${INTERNAL_API_BEARER_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${CONTROL_API_BASE_URL}${path}`, {
    method: "GET",
    headers: apiHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${CONTROL_API_BASE_URL}${path}`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "oauth-broker-mcp",
  version: "0.1.0",
});

// --- list_oauth_registrations -----------------------------------------------

server.tool(
  "list_oauth_registrations",
  "List OAuth registrations for a given issue",
  {
    issueId: z.string().describe("The issue ID to look up registrations for"),
  },
  async ({ issueId }) => {
    try {
      const data = await apiGet(
        `/internal/issues/${encodeURIComponent(issueId)}/integrations/oauth-registrations`,
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- create_oauth_registration ----------------------------------------------

server.tool(
  "create_oauth_registration",
  "Create a new OAuth registration. Only aliases are accepted for secrets — raw secret values are denied.",
  {
    issueId: z.string().describe("Associated issue ID"),
    providerName: z.string().describe("OAuth provider name (e.g. github, google)"),
    environment: z.string().describe("Target environment (e.g. development, production)"),
    clientType: z.string().describe("OAuth client type (e.g. confidential, public)"),
    authScheme: z.string().describe("Auth scheme (e.g. authorization_code, client_credentials)"),
    clientIdAlias: z.string().describe("Alias referencing the client ID in the secret store"),
    clientSecretAlias: z
      .string()
      .optional()
      .describe("Alias referencing the client secret in the secret store (optional for public clients)"),
    redirectUris: z.array(z.string()).describe("Allowed redirect URIs"),
    scopes: z.array(z.string()).describe("Requested OAuth scopes"),
    registrationState: z.string().describe("Initial state (e.g. draft, active)"),
  },
  async (params) => {
    try {
      const data = await apiPost("/internal/integrations/oauth-registrations", {
        issueId: params.issueId,
        providerName: params.providerName,
        environment: params.environment,
        clientType: params.clientType,
        authScheme: params.authScheme,
        clientIdAlias: params.clientIdAlias,
        clientSecretAlias: params.clientSecretAlias,
        redirectUris: params.redirectUris,
        scopes: params.scopes,
        registrationState: params.registrationState,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- list_consent_sessions --------------------------------------------------

server.tool(
  "list_consent_sessions",
  "List OAuth consent sessions for a given issue",
  {
    issueId: z.string().describe("The issue ID to look up consent sessions for"),
  },
  async ({ issueId }) => {
    try {
      const data = await apiGet(
        `/internal/issues/${encodeURIComponent(issueId)}/integrations/oauth-consents`,
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- initiate_consent -------------------------------------------------------

server.tool(
  "initiate_consent",
  "Initiate an OAuth consent session. No manual token exchange is performed — only consent initiation.",
  {
    issueId: z.string().describe("Associated issue ID"),
    providerName: z.string().describe("OAuth provider name"),
    registrationId: z
      .string()
      .optional()
      .describe("Existing registration ID to bind to (optional)"),
    state: z.string().describe("OAuth state parameter"),
    pkceVerifierAlias: z
      .string()
      .optional()
      .describe("Alias for the PKCE code verifier in the secret store"),
    codeChallengeMethod: z
      .string()
      .optional()
      .describe("PKCE code challenge method (e.g. S256)"),
    requestedScopes: z.array(z.string()).describe("Scopes to request during consent"),
    consentUrl: z.string().optional().describe("Pre-built consent URL (optional)"),
  },
  async (params) => {
    try {
      const data = await apiPost("/internal/integrations/consent-sessions", {
        issueId: params.issueId,
        providerName: params.providerName,
        registrationId: params.registrationId,
        state: params.state,
        pkceVerifierAlias: params.pkceVerifierAlias,
        codeChallengeMethod: params.codeChallengeMethod,
        requestedScopes: params.requestedScopes,
        consentUrl: params.consentUrl,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- check_consent_status ---------------------------------------------------

server.tool(
  "check_consent_status",
  "Check the latest consent session status for an issue",
  {
    issueId: z.string().describe("The issue ID to check consent status for"),
  },
  async ({ issueId }) => {
    try {
      const data = (await apiGet(
        `/internal/issues/${encodeURIComponent(issueId)}/integrations/oauth-consents`,
      )) as unknown[];

      if (!Array.isArray(data) || data.length === 0) {
        return {
          content: [{ type: "text", text: "No consent sessions found for this issue." }],
        };
      }

      const latest = data[data.length - 1];
      return {
        content: [
          {
            type: "text",
            text: `Latest consent session:\n${JSON.stringify(latest, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- validate_redirect_uri --------------------------------------------------

server.tool(
  "validate_redirect_uri",
  "Validate a redirect URI locally: checks HTTPS, no fragments, and optional pattern matching",
  {
    uri: z.string().describe("The redirect URI to validate"),
    allowedPatterns: z
      .array(z.string())
      .optional()
      .describe("Optional glob/regex patterns the URI must match"),
  },
  async ({ uri, allowedPatterns }) => {
    const errors: string[] = [];

    // Parse the URI
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return {
        content: [{ type: "text", text: "Invalid URI: unable to parse." }],
        isError: true,
      };
    }

    // Must be HTTPS (allow http only for localhost development)
    const isLocalhost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !isLocalhost) {
      errors.push("Redirect URI must use HTTPS (non-localhost).");
    }

    // No fragments
    if (parsed.hash) {
      errors.push("Redirect URI must not contain a fragment (#).");
    }

    // Pattern matching
    if (allowedPatterns && allowedPatterns.length > 0) {
      const matched = allowedPatterns.some((pattern) => {
        try {
          const re = new RegExp(pattern);
          return re.test(uri);
        } catch {
          errors.push(`Invalid pattern: ${pattern}`);
          return false;
        }
      });
      if (!matched && errors.length === 0) {
        errors.push(
          `URI does not match any allowed pattern: ${allowedPatterns.join(", ")}`,
        );
      }
    }

    if (errors.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `Validation failed:\n${errors.map((e) => `- ${e}`).join("\n")}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: `Redirect URI is valid: ${uri}` }],
    };
  },
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
