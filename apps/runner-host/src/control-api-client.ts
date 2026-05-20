import type {
  RunnerArtifactResourceV1,
  RunnerCapabilityManifestV1,
  RunnerArtifactStageRequestV1,
  RunnerArtifactStageResponseV1,
  RunnerAttemptCancelRequestV1,
  RunnerAttemptCancelResponseV1,
  RunnerAttemptCompletionRequestV1,
  RunnerAttemptFailureRequestV1,
  RunnerContextPackResourceV1,
  RunnerExecutionBundleV1,
  RunnerExecutionStartedRequestV1,
  RunnerHeartbeatRequestV1,
  RunnerHeartbeatResponseV1,
  RunnerLeaseClaimRequestV1,
  RunnerLeaseClaimResponseV1,
  RunnerManagedSkillPayloadV1,
  RunnerManagedSkillSummaryV1,
  RunnerManifestUpsertRequestV1,
  RunnerManifestUpsertResponseV1,
} from '@ai-dev-team/shared'

type RequestOptions = {
  method: string
  path: string
  body?: unknown
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''

  return contentType.includes('application/json')
}

export class RunnerControlApiClient {
  private readonly baseUrl: string
  private readonly authToken: string
  private readonly runnerNodeId: string

  constructor(options: {
    baseUrl: string
    authToken: string
    runnerNodeId: string
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.authToken = options.authToken
    this.runnerNodeId = options.runnerNodeId
  }

  private async request<T>({
    method,
    path,
    body,
  }: RequestOptions): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Runner control API request failed for ${method} ${path}: ${response.status} ${response.statusText} ${text}`,
      )
    }

    if (response.status === 204) {
      return undefined as T
    }

    if (!isJsonResponse(response)) {
      const text = await response.text()

      if (!text.trim()) {
        return undefined as T
      }

      return JSON.parse(text) as T
    }

    return (await response.json()) as T
  }

  publishManifest(
    manifest: RunnerCapabilityManifestV1,
  ): Promise<RunnerManifestUpsertResponseV1> {
    const body: RunnerManifestUpsertRequestV1 = {
      schemaVersion: 1,
      manifest,
    }

    return this.request({
      method: 'PUT',
      path: '/runner-host/manifests/current',
      body,
    })
  }

  claimNext(
    heartbeatExpiryAt: string,
  ): Promise<RunnerLeaseClaimResponseV1> {
    const body: RunnerLeaseClaimRequestV1 = {
      schemaVersion: 1,
      runnerNodeId: this.runnerNodeId,
      heartbeatExpiryAt,
    }

    return this.request({
      method: 'POST',
      path: '/runner-host/leases:claim-next',
      body,
    })
  }

  fetchContextPack(
    contextPackId: string,
  ): Promise<RunnerContextPackResourceV1> {
    return this.request({
      method: 'GET',
      path: `/runner-host/context-packs/${contextPackId}`,
    })
  }

  fetchArtifact(
    artifactId: string,
  ): Promise<RunnerArtifactResourceV1> {
    return this.request({
      method: 'GET',
      path: `/runner-host/artifacts/${artifactId}`,
    })
  }

  fetchExecutionBundle(
    leaseAttemptId: string,
  ): Promise<RunnerExecutionBundleV1> {
    return this.request({
      method: 'GET',
      path: `/runner-host/attempts/${leaseAttemptId}/execution-bundle`,
    })
  }

  fetchActiveSkillReleaseSummary(): Promise<RunnerManagedSkillSummaryV1> {
    return this.request({
      method: 'GET',
      path: '/runner-host/skill-sync/active-release',
    })
  }

  fetchSkillReleasePayload(
    releaseId: string,
  ): Promise<RunnerManagedSkillPayloadV1> {
    return this.request({
      method: 'GET',
      path: `/runner-host/skill-sync/releases/${releaseId}`,
    })
  }

  executionStarted(payload: RunnerExecutionStartedRequestV1): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.leaseAttemptId}/execution-started`,
      body: payload,
    })
  }

  heartbeat(
    payload: RunnerHeartbeatRequestV1,
  ): Promise<RunnerHeartbeatResponseV1> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.leaseAttemptId}/heartbeat`,
      body: payload,
    })
  }

  stageArtifact(
    payload: RunnerArtifactStageRequestV1,
  ): Promise<RunnerArtifactStageResponseV1> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.leaseAttemptId}/artifacts`,
      body: payload,
    })
  }

  completeAttempt(payload: RunnerAttemptCompletionRequestV1): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.artifactBundle.leaseAttemptId}/completed`,
      body: payload,
    })
  }

  failAttempt(payload: RunnerAttemptFailureRequestV1): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.leaseAttemptId}/failed`,
      body: payload,
    })
  }

  cancelAttempt(
    payload: RunnerAttemptCancelRequestV1,
  ): Promise<RunnerAttemptCancelResponseV1> {
    return this.request({
      method: 'POST',
      path: `/runner-host/attempts/${payload.leaseAttemptId}/cancel`,
      body: payload,
    })
  }
}
