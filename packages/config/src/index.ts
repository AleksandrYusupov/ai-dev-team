import {
  AGENT_PROVIDERS,
  APP_ENVIRONMENTS,
  DEFAULT_TEMPORAL_NAMESPACE,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  INTEGRATION_NETWORK_MODES,
  LOG_LEVELS,
  RUN_KINDS,
  type AgentProvider,
  type AppEnvironment,
  type IntegrationNetworkMode,
  type LogLevel,
  type RunKind,
} from '@ai-dev-team/shared'

type EnvMap = NodeJS.ProcessEnv

export interface DatabaseConfig {
  url: string
  poolMax: number
}

interface ServiceBaseConfig {
  serviceName: string
  environment: AppEnvironment
  logLevel: LogLevel
  version: string
}

export interface ControlApiConfig extends ServiceBaseConfig {
  host: string
  port: number
  database: DatabaseConfig
  internalApiBearerToken: string
  runner: {
    authTokensByNodeId: Record<string, string>
    longPollMaxWaitMs: number
  }
  ingress: {
    linearWebhookSecret: string
    githubWebhookSecret: string
    replayWindowMs: number
    maxPayloadBytes: number
  }
  knowledge: {
    contextPackMaxTokens: number
    contextPackMaxComments: number
    contextPackMaxNotes: number
  }
  integration: {
    vendorDocsAllowlist: string[]
    secretService: {
      backend: string
      gcpProjectId: string | null
      defaultSecretPrefix: string
    }
    oauthService: {
      publicCallbackBaseUrl: string
      defaultRedirectPathPrefix: string
      enforcePkce: boolean
    }
    integrationLab: {
      enabled: boolean
      maxProbeRequests: number
      allowedSandboxDomains: string[]
    }
  }
}

export interface WorkflowWorkerConfig extends ServiceBaseConfig {
  database: DatabaseConfig
  linear: {
    apiToken: string | null
    apiBaseUrl: string
  }
  outbox: {
    batchSize: number
    pollIntervalMs: number
    maxAttempts: number
    processingTimeoutMs: number
  }
  inbox: {
    batchSize: number
    pollIntervalMs: number
    maxAttempts: number
    replayWindowMs: number
  }
  temporal: {
    address: string
    namespace: string
    taskQueue: string
  }
  integration: {
    networkModesSupported: IntegrationNetworkMode[]
    allowedDocDomains: string[]
    allowedSandboxDomains: string[]
    supportsBrowserConsent: boolean
    supportsSecretBroker: boolean
    supportsOAuthBroker: boolean
    supportsIntegrationLab: boolean
  }
}

export interface KnowledgeSyncConfig {
  database: DatabaseConfig
  vaultRoot: string
  batchSize: number
  maxNoteBytes: number
}

export interface RunnerHostConfig extends ServiceBaseConfig {
  controlApiBaseUrl: string
  runnerNodeId: string
  hostGroupId: string
  authToken: string
  pollTimeoutMs: number
  heartbeatIntervalMs: number
  heartbeatExpiryMs: number
  maxConcurrentLeases: number
  workspaceRoot: string
  worktreeRoot: string
  artifactRoot: string
  providers: AgentProvider[]
  supportedRoles: string[]
  supportedRunKinds: RunKind[]
  supportedRepoKinds: string[]
  toolBaseline: string[]
  mcpConfigHash: string
  mcpHostServers: string[]
  mcpRepoServers: string[]
  mcpExclusiveServers: string[]
  supportsInterrupt: boolean
  supportsCheckpointResume: boolean
  supportsArtifactUpload: boolean
  supportsConcurrentSessions: boolean
  integration: {
    networkModesSupported: IntegrationNetworkMode[]
    allowedDocDomains: string[]
    allowedSandboxDomains: string[]
    supportsBrowserConsent: boolean
    supportsSecretBroker: boolean
    supportsOAuthBroker: boolean
    supportsIntegrationLab: boolean
  }
  providerCliBins: Partial<Record<AgentProvider, string>>
  commands: Partial<Record<AgentProvider, string>>
  mcpCommandsByServer: Record<string, string>
}

function requiredString(env: EnvMap, key: string): string {
  const value = env[key]

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value
}

function optionalString(env: EnvMap, key: string, fallback: string): string {
  return env[key] ?? fallback
}

function optionalNonEmptyString(env: EnvMap, key: string): string | null {
  const value = env[key]

  return value && value.trim().length > 0 ? value.trim() : null
}

function parseBooleanWithFallback(
  env: EnvMap,
  key: string,
  fallback: boolean,
): boolean {
  const raw = env[key]

  if (raw === undefined) {
    return fallback
  }

  if (raw === 'true') {
    return true
  }

  if (raw === 'false') {
    return false
  }

  throw new Error(`Environment variable ${key} must be true or false`)
}

function parseCsvList(
  env: EnvMap,
  key: string,
  fallback: string[],
): string[] {
  const raw = env[key]

  if (raw === undefined) {
    return fallback
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseIntegrationNetworkModes(
  env: EnvMap,
  key: string,
  fallback: IntegrationNetworkMode[],
): IntegrationNetworkMode[] {
  const values = parseCsvList(env, key, fallback)

  if (
    values.some(
      (value) =>
        !INTEGRATION_NETWORK_MODES.includes(value as IntegrationNetworkMode),
    )
  ) {
    throw new Error(
      `Environment variable ${key} must contain only: ${INTEGRATION_NETWORK_MODES.join(', ')}`,
    )
  }

  return values as IntegrationNetworkMode[]
}

function parseAgentProviders(
  env: EnvMap,
  key: string,
  fallback: AgentProvider[],
): AgentProvider[] {
  const values = parseCsvList(env, key, fallback)

  if (values.some((value) => !AGENT_PROVIDERS.includes(value as AgentProvider))) {
    throw new Error(
      `Environment variable ${key} must contain only: ${AGENT_PROVIDERS.join(', ')}`,
    )
  }

  return values as AgentProvider[]
}

function parseRunKinds(
  env: EnvMap,
  key: string,
  fallback: RunKind[],
): RunKind[] {
  const values = parseCsvList(env, key, fallback)

  if (values.some((value) => !RUN_KINDS.includes(value as RunKind))) {
    throw new Error(
      `Environment variable ${key} must contain only: ${RUN_KINDS.join(', ')}`,
    )
  }

  return values as RunKind[]
}

function parseJsonStringMap(
  env: EnvMap,
  key: string,
  fallback: Record<string, string>,
): Record<string, string> {
  const raw = env[key]

  if (raw === undefined) {
    return fallback
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Environment variable ${key} must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Environment variable ${key} must be a JSON object`)
  }

  const entries = Object.entries(parsed as Record<string, unknown>)
  const result: Record<string, string> = {}

  for (const [mapKey, value] of entries) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `Environment variable ${key} must map each key to a non-empty string`,
      )
    }

    result[mapKey] = value
  }

  return result
}

function loadInternalApiBearerToken(env: EnvMap): string {
  const value = env.INTERNAL_API_BEARER_TOKEN

  if (value && value.trim().length > 0) {
    return value
  }

  if ((env.NODE_ENV ?? 'development') === 'test') {
    return 'test-internal-api-bearer-token'
  }

  throw new Error(
    'Missing required environment variable: INTERNAL_API_BEARER_TOKEN',
  )
}

function parseIntWithFallback(
  env: EnvMap,
  key: string,
  fallback: number,
): number {
  const raw = env[key]

  if (raw === undefined) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`)
  }

  return parsed
}

function parseEnvironment(env: EnvMap): AppEnvironment {
  const value = env.NODE_ENV ?? 'development'

  if (!APP_ENVIRONMENTS.includes(value as AppEnvironment)) {
    throw new Error(
      `NODE_ENV must be one of: ${APP_ENVIRONMENTS.join(', ')}`,
    )
  }

  return value as AppEnvironment
}

function parseLogLevel(env: EnvMap): LogLevel {
  const value = env.LOG_LEVEL ?? 'info'

  if (!LOG_LEVELS.includes(value as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`)
  }

  return value as LogLevel
}

function baseConfig(env: EnvMap, serviceName: string): ServiceBaseConfig {
  return {
    serviceName,
    environment: parseEnvironment(env),
    logLevel: parseLogLevel(env),
    version: env.APP_VERSION ?? '0.1.0',
  }
}

export function loadDatabaseConfig(env: EnvMap = process.env): DatabaseConfig {
  return {
    url: requiredString(env, 'DATABASE_URL'),
    poolMax: parseIntWithFallback(env, 'DB_POOL_MAX', 10),
  }
}

export function loadControlApiConfig(
  env: EnvMap = process.env,
): ControlApiConfig {
  return {
    ...baseConfig(env, 'control-api'),
    host: optionalString(env, 'CONTROL_API_HOST', '127.0.0.1'),
    port: parseIntWithFallback(env, 'CONTROL_API_PORT', 4000),
    database: loadDatabaseConfig(env),
    internalApiBearerToken: loadInternalApiBearerToken(env),
    runner: {
      authTokensByNodeId: parseJsonStringMap(env, 'RUNNER_AUTH_TOKENS_JSON', {}),
      longPollMaxWaitMs: parseIntWithFallback(
        env,
        'RUNNER_LONG_POLL_MAX_WAIT_MS',
        20_000,
      ),
    },
    ingress: {
      linearWebhookSecret: requiredString(env, 'LINEAR_WEBHOOK_SECRET'),
      githubWebhookSecret: requiredString(env, 'GITHUB_WEBHOOK_SECRET'),
      replayWindowMs: parseIntWithFallback(env, 'WEBHOOK_REPLAY_WINDOW_MS', 60_000),
      maxPayloadBytes: parseIntWithFallback(env, 'WEBHOOK_MAX_PAYLOAD_BYTES', 1_048_576),
    },
    knowledge: {
      contextPackMaxTokens: parseIntWithFallback(
        env,
        'CONTEXT_PACK_MAX_TOKENS',
        16_000,
      ),
      contextPackMaxComments: parseIntWithFallback(
        env,
        'CONTEXT_PACK_MAX_COMMENTS',
        10,
      ),
      contextPackMaxNotes: parseIntWithFallback(
        env,
        'CONTEXT_PACK_MAX_NOTES',
        12,
      ),
    },
    integration: {
      vendorDocsAllowlist: parseCsvList(env, 'VENDOR_DOCS_ALLOWLIST', []),
      secretService: {
        backend: optionalString(
          env,
          'SECRET_SERVICE_BACKEND',
          'gcp_secret_manager',
        ),
        gcpProjectId: optionalNonEmptyString(
          env,
          'GCP_SECRET_MANAGER_PROJECT_ID',
        ),
        defaultSecretPrefix: optionalString(
          env,
          'SECRET_SERVICE_DEFAULT_PREFIX',
          'ai-dev-team',
        ),
      },
      oauthService: {
        publicCallbackBaseUrl: optionalString(
          env,
          'OAUTH_PUBLIC_CALLBACK_BASE_URL',
          'http://127.0.0.1:4000/oauth/callback',
        ),
        defaultRedirectPathPrefix: optionalString(
          env,
          'OAUTH_REDIRECT_PATH_PREFIX',
          '/oauth/callback',
        ),
        enforcePkce: parseBooleanWithFallback(
          env,
          'OAUTH_ENFORCE_PKCE',
          true,
        ),
      },
      integrationLab: {
        enabled: parseBooleanWithFallback(
          env,
          'INTEGRATION_LAB_ENABLED',
          true,
        ),
        maxProbeRequests: parseIntWithFallback(
          env,
          'INTEGRATION_LAB_MAX_PROBE_REQUESTS',
          5,
        ),
        allowedSandboxDomains: parseCsvList(
          env,
          'INTEGRATION_LAB_ALLOWED_SANDBOX_DOMAINS',
          [],
        ),
      },
    },
  }
}

export function loadWorkflowWorkerConfig(
  env: EnvMap = process.env,
): WorkflowWorkerConfig {
  return {
    ...baseConfig(env, 'workflow-worker'),
    database: loadDatabaseConfig(env),
    linear: {
      apiToken: optionalNonEmptyString(env, 'LINEAR_API_TOKEN'),
      apiBaseUrl: optionalString(env, 'LINEAR_API_BASE_URL', 'https://api.linear.app/graphql'),
    },
    outbox: {
      batchSize: parseIntWithFallback(env, 'WORKFLOW_OUTBOX_BATCH_SIZE', 25),
      pollIntervalMs: parseIntWithFallback(
        env,
        'WORKFLOW_OUTBOX_POLL_INTERVAL_MS',
        1_000,
      ),
      maxAttempts: parseIntWithFallback(env, 'WORKFLOW_OUTBOX_MAX_ATTEMPTS', 5),
      processingTimeoutMs: parseIntWithFallback(
        env,
        'WORKFLOW_OUTBOX_PROCESSING_TIMEOUT_MS',
        30_000,
      ),
    },
    inbox: {
      batchSize: parseIntWithFallback(env, 'WORKFLOW_INGRESS_BATCH_SIZE', 25),
      pollIntervalMs: parseIntWithFallback(
        env,
        'WORKFLOW_INGRESS_POLL_INTERVAL_MS',
        1_000,
      ),
      maxAttempts: parseIntWithFallback(env, 'WORKFLOW_INGRESS_MAX_ATTEMPTS', 5),
      replayWindowMs: parseIntWithFallback(
        env,
        'WEBHOOK_REPLAY_WINDOW_MS',
        60_000,
      ),
    },
    temporal: {
      address: optionalString(env, 'TEMPORAL_SERVER_ADDRESS', '127.0.0.1:7233'),
      namespace: optionalString(
        env,
        'TEMPORAL_NAMESPACE',
        DEFAULT_TEMPORAL_NAMESPACE,
      ),
      taskQueue: optionalString(
        env,
        'TEMPORAL_TASK_QUEUE',
        DEFAULT_TEMPORAL_TASK_QUEUE,
      ),
    },
    integration: {
      networkModesSupported: parseIntegrationNetworkModes(
        env,
        'RUNNER_NETWORK_MODES_SUPPORTED',
        ['docs_allowlist', 'sandbox_api_allowlist'],
      ),
      allowedDocDomains: parseCsvList(env, 'RUNNER_ALLOWED_DOC_DOMAINS', []),
      allowedSandboxDomains: parseCsvList(
        env,
        'RUNNER_ALLOWED_SANDBOX_DOMAINS',
        [],
      ),
      supportsBrowserConsent: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_BROWSER_CONSENT',
        false,
      ),
      supportsSecretBroker: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_SECRET_BROKER',
        false,
      ),
      supportsOAuthBroker: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_OAUTH_BROKER',
        false,
      ),
      supportsIntegrationLab: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_INTEGRATION_LAB',
        false,
      ),
    },
  }
}

export function loadKnowledgeSyncConfig(
  env: EnvMap = process.env,
): KnowledgeSyncConfig {
  return {
    database: loadDatabaseConfig(env),
    vaultRoot: requiredString(env, 'KNOWLEDGE_SYNC_VAULT_ROOT'),
    batchSize: parseIntWithFallback(env, 'KNOWLEDGE_SYNC_BATCH_SIZE', 100),
    maxNoteBytes: parseIntWithFallback(
      env,
      'KNOWLEDGE_SNAPSHOT_MAX_NOTE_BYTES',
      131_072,
    ),
  }
}

export function loadRunnerHostConfig(
  env: EnvMap = process.env,
): RunnerHostConfig {
  const providerCliBins: Partial<Record<AgentProvider, string>> = {}
  const codexCliBin = optionalNonEmptyString(env, 'CODEX_CLI_BIN')
  const claudeCliBin = optionalNonEmptyString(env, 'CLAUDE_CLI_BIN')

  if (codexCliBin) {
    providerCliBins.codex = codexCliBin
  }

  if (claudeCliBin) {
    providerCliBins.claude = claudeCliBin
  }

  return {
    ...baseConfig(env, 'runner-host'),
    controlApiBaseUrl: optionalString(
      env,
      'RUNNER_POLL_BASE_URL',
      'http://127.0.0.1:4000',
    ),
    runnerNodeId: requiredString(env, 'RUNNER_NODE_ID'),
    hostGroupId: requiredString(env, 'RUNNER_HOST_GROUP_ID'),
    authToken: requiredString(env, 'RUNNER_AUTH_TOKEN'),
    pollTimeoutMs: parseIntWithFallback(env, 'RUNNER_POLL_TIMEOUT_MS', 20_000),
    heartbeatIntervalMs: parseIntWithFallback(
      env,
      'RUNNER_HEARTBEAT_INTERVAL_MS',
      15_000,
    ),
    heartbeatExpiryMs: parseIntWithFallback(
      env,
      'RUNNER_HEARTBEAT_EXPIRY_MS',
      45_000,
    ),
    maxConcurrentLeases: parseIntWithFallback(
      env,
      'RUNNER_MAX_CONCURRENT_LEASES',
      1,
    ),
    workspaceRoot: requiredString(env, 'RUNNER_WORKSPACE_ROOT'),
    worktreeRoot: requiredString(env, 'RUNNER_WORKTREE_ROOT'),
    artifactRoot: requiredString(env, 'RUNNER_ARTIFACT_ROOT'),
    providers: parseAgentProviders(env, 'RUNNER_PROVIDERS', ['codex']),
    supportedRoles: parseCsvList(env, 'RUNNER_SUPPORTED_ROLES', [
      'intake_agent',
      'spec_agent',
      'architect_agent',
      'plan_agent',
      'build_agent',
      'review_agent',
      'release_agent',
      'reporter_agent',
      'monitoring_agent',
      'integration_agent',
      'orchestrator',
    ]),
    supportedRunKinds: parseRunKinds(env, 'RUNNER_SUPPORTED_RUN_KINDS', [
      'build',
      'review',
      'deploy',
      'rework_cycle',
    ]),
    supportedRepoKinds: parseCsvList(env, 'RUNNER_SUPPORTED_REPO_KINDS', [
      'application',
    ]),
    toolBaseline: parseCsvList(env, 'RUNNER_TOOL_BASELINE', [
      'serena',
      'sequential-thinking',
      'obsidian',
      'context7',
      'github',
      'git',
      'filesystem',
      'linear',
      'postgres',
      'fetch',
      'memory',
    ]),
    mcpConfigHash: requiredString(env, 'RUNNER_MCP_CONFIG_HASH'),
    mcpHostServers: parseCsvList(env, 'RUNNER_MCP_HOST_SERVERS', []),
    mcpRepoServers: parseCsvList(env, 'RUNNER_MCP_REPO_SERVERS', []),
    mcpExclusiveServers: parseCsvList(env, 'RUNNER_MCP_EXCLUSIVE_SERVERS', []),
    supportsInterrupt: parseBooleanWithFallback(
      env,
      'RUNNER_SUPPORTS_INTERRUPT',
      true,
    ),
    supportsCheckpointResume: parseBooleanWithFallback(
      env,
      'RUNNER_SUPPORTS_CHECKPOINT_RESUME',
      false,
    ),
    supportsArtifactUpload: parseBooleanWithFallback(
      env,
      'RUNNER_SUPPORTS_ARTIFACT_UPLOAD',
      true,
    ),
    supportsConcurrentSessions: parseBooleanWithFallback(
      env,
      'RUNNER_SUPPORTS_CONCURRENT_SESSIONS',
      true,
    ),
    providerCliBins,
    integration: {
      networkModesSupported: parseIntegrationNetworkModes(
        env,
        'RUNNER_NETWORK_MODES_SUPPORTED',
        ['docs_allowlist', 'sandbox_api_allowlist'],
      ),
      allowedDocDomains: parseCsvList(env, 'RUNNER_ALLOWED_DOC_DOMAINS', []),
      allowedSandboxDomains: parseCsvList(
        env,
        'RUNNER_ALLOWED_SANDBOX_DOMAINS',
        [],
      ),
      supportsBrowserConsent: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_BROWSER_CONSENT',
        false,
      ),
      supportsSecretBroker: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_SECRET_BROKER',
        false,
      ),
      supportsOAuthBroker: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_OAUTH_BROKER',
        false,
      ),
      supportsIntegrationLab: parseBooleanWithFallback(
        env,
        'RUNNER_SUPPORTS_INTEGRATION_LAB',
        false,
      ),
    },
    commands: {
      codex: optionalNonEmptyString(env, 'CODEX_COMMAND') ?? undefined,
      claude: optionalNonEmptyString(env, 'CLAUDE_CODE_COMMAND') ?? undefined,
    },
    mcpCommandsByServer: parseJsonStringMap(
      env,
      'RUNNER_MCP_COMMANDS_JSON',
      {},
    ),
  }
}
