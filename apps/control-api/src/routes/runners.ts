import type { FastifyPluginAsync } from 'fastify'

import type { RunnerReadRepository, RunnerWriteRepository } from '../runners.js'

interface RunnerRoutesOptions {
  runnerReadRepository: RunnerReadRepository
  runnerWriteRepository: RunnerWriteRepository
}

export const runnerRoutes: FastifyPluginAsync<RunnerRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/runners/inventory', async () => {
    return options.runnerReadRepository.listRunnerInventory()
  })

  app.get('/runners/leases/active', async () => {
    return options.runnerReadRepository.listActiveLeases()
  })

  app.get('/runners/leases/stale', async () => {
    return options.runnerReadRepository.listStaleLeases()
  })

  app.get('/runners/mcp-pool', async () => {
    return options.runnerReadRepository.listMcpPoolSnapshots()
  })

  app.get('/runners/leases/:leaseId', async (request, reply) => {
    const { leaseId } = request.params as { leaseId: string }
    const detail = await options.runnerReadRepository.getLeaseDetail(leaseId)

    if (!detail) {
      return reply.status(404).send({ error: 'runner_lease_not_found' })
    }

    return detail
  })

  app.get('/runners/metrics/provider-failover', async () => {
    return options.runnerReadRepository.getProviderFailoverMetrics()
  })

  app.post('/runners/leases/:leaseId/cancel', async (request, reply) => {
    const { leaseId } = request.params as { leaseId: string }
    const body = (request.body ?? {}) as {
      reasonCode?: string | null
      reasonText?: string | null
    }

    const result = await options.runnerWriteRepository.requestLeaseCancellation({
      leaseId,
      reasonCode: body.reasonCode ?? null,
      reasonText: body.reasonText ?? null,
    })

    return reply.status(202).send(result)
  })
}
