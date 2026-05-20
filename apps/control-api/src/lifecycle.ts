import {
  getIssueRuntimeStateView,
  getIssueJourney,
  getLifecycleSnapshotView,
  getSystemHealthView,
  getAgentMetricsDaily,
  listStuckIssues,
  refreshAgentMetricsDaily,
  upsertLifecycleCommand,
  type AgentMetricsDailyView as DbAgentMetricsDailyView,
  type DbClient,
  type IssueJourneyView as DbIssueJourneyView,
  type LifecycleCommandInboxRecord,
  type StuckIssueView as DbStuckIssueView,
  type SystemHealthView as DbSystemHealthView,
} from '@ai-dev-team/db'
import {
  type LifecycleCommandEnvelopeV1,
  type LifecycleSnapshotV1,
} from '@ai-dev-team/shared'

export type LifecycleCommandEnvelopeInput = LifecycleCommandEnvelopeV1
export type LifecycleCommandRecord = LifecycleCommandInboxRecord
export type LifecycleSnapshotView = LifecycleSnapshotV1
export type LifecycleJourneyView = DbIssueJourneyView
export type DailyMetricsView = DbAgentMetricsDailyView
export type SystemHealthView = DbSystemHealthView
export type StuckIssueView = DbStuckIssueView

export interface LifecycleReadRepository {
  persistLifecycleCommand(
    input: LifecycleCommandEnvelopeInput,
  ): Promise<LifecycleCommandRecord & { wasDuplicate: boolean }>
  getLifecycleSnapshot(issueId: string): Promise<LifecycleSnapshotView | null>
  getIssueJourney(issueId: string): Promise<LifecycleJourneyView | null>
  getSystemHealth(): Promise<SystemHealthView>
  getStuckIssues(): Promise<StuckIssueView[]>
  getDailyMetrics(date: string): Promise<DailyMetricsView>
}

export function createLifecycleReadRepository({
  db,
}: {
  db: DbClient
}): LifecycleReadRepository {
  return {
    async persistLifecycleCommand(
      input: LifecycleCommandEnvelopeInput,
    ): Promise<LifecycleCommandRecord & { wasDuplicate: boolean }> {
      const persisted = await upsertLifecycleCommand(db, input)

      return {
        ...persisted.record,
        wasDuplicate: !persisted.inserted,
      }
    },

    async getLifecycleSnapshot(
      issueId: string,
    ): Promise<LifecycleSnapshotView | null> {
      return getLifecycleSnapshotView(db, issueId)
    },

    async getIssueJourney(issueId: string): Promise<LifecycleJourneyView | null> {
      const runtimeState = await getIssueRuntimeStateView(db, issueId)
      const journey = await getIssueJourney(db, issueId)

      if (
        !runtimeState &&
        journey.commands.length === 0 &&
        journey.transitions.length === 0 &&
        journey.runs.length === 0 &&
        journey.artifacts.length === 0
      ) {
        return null
      }

      return journey
    },

    getSystemHealth: () => getSystemHealthView(db),
    getStuckIssues: () => listStuckIssues(db),

    async getDailyMetrics(date: string): Promise<DailyMetricsView> {
      const existing = await getAgentMetricsDaily(db, date)

      if (existing) {
        return existing
      }

      return refreshAgentMetricsDaily(db, date)
    },
  }
}
