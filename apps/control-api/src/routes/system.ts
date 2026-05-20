import type { ControlApiConfig } from '@ai-dev-team/config'
import type { HealthReport } from '@ai-dev-team/shared'
import type { FastifyPluginAsync } from 'fastify'

interface SystemRoutesOptions {
  config: ControlApiConfig
}

export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (
  app,
  options,
) => {
  app.get('/healthz', async (): Promise<HealthReport> => {
    return {
      status: 'ok',
      service: options.config.serviceName,
      environment: options.config.environment,
      version: options.config.version,
      time: new Date().toISOString(),
    }
  })
}

