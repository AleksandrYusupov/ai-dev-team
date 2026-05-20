import type { Database } from '@ai-dev-team/db'
import type { Selectable } from 'kysely'

import type { TransitionArtifactInput } from './types.js'

interface ArtifactPresenceInput {
  requiredArtifactTypes: string[]
  artifactScope: string
  issueId: string
  activeRunId: string | null
  persistedArtifacts: Selectable<Database['artifact_registry']>[]
  stagedArtifacts: TransitionArtifactInput[]
}

export function validateRequiredArtifacts(
  input: ArtifactPresenceInput,
): string[] {
  const failures: string[] = []

  for (const artifactType of input.requiredArtifactTypes) {
    const stagedMatch = input.stagedArtifacts.some(
      (artifact) =>
        artifact.artifactType === artifactType &&
        artifact.artifactScope === input.artifactScope,
    )

    const persistedMatch = input.persistedArtifacts.some((artifact) => {
      if (artifact.artifact_type !== artifactType) {
        return false
      }

      if (artifact.artifact_scope !== input.artifactScope) {
        return false
      }

      if (artifact.superseded_at !== null) {
        return false
      }

      if (input.artifactScope === 'run') {
        return artifact.run_id === input.activeRunId
      }

      if (input.artifactScope === 'transition') {
        return false
      }

      return artifact.issue_id === input.issueId
    })

    if (!stagedMatch && !persistedMatch) {
      failures.push(`missing_artifact:${artifactType}:${input.artifactScope}`)
    }
  }

  return failures
}
