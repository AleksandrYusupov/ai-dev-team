import type { FastifyPluginAsync } from 'fastify'

import type { WorkflowReadRepository } from '../app.js'

interface WorkflowRoutesOptions {
  workflowReadRepository: WorkflowReadRepository
}

export const workflowRoutes: FastifyPluginAsync<WorkflowRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/workflow-config/active', async (_request, reply) => {
    const config = await options.workflowReadRepository.getActiveWorkflowConfig()

    if (!config) {
      return reply.status(503).send({
        error: 'active_workflow_config_not_found',
      })
    }

    return config
  })

  app.get('/issues/:issueId/runtime-state', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const runtimeState =
      await options.workflowReadRepository.getIssueRuntimeState(issueId)

    if (!runtimeState) {
      return reply.status(404).send({ error: 'issue_runtime_state_not_found' })
    }

    return runtimeState
  })

  app.get('/issues/:issueId/status-projection', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const projection =
      await options.workflowReadRepository.getStatusProjection(issueId)

    if (!projection) {
      return reply.status(404).send({ error: 'status_projection_not_found' })
    }

    return projection
  })

  app.get('/issues/:issueId/linear-sync-projection', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const projection =
      await options.workflowReadRepository.getIssueLinearSyncProjection(issueId)

    if (!projection) {
      return reply.status(404).send({ error: 'linear_sync_projection_not_found' })
    }

    return projection
  })

  app.get('/issues/:issueId/blocked-projection', async (request, reply) => {
    const { issueId } = request.params as { issueId: string }
    const projection =
      await options.workflowReadRepository.getBlockedIssueProjection(issueId)

    if (!projection) {
      return reply.status(404).send({ error: 'blocked_issue_projection_not_found' })
    }

    return projection
  })
}
